import type { IncomingMessage, ServerResponse } from "node:http";
import { InputFile } from "grammy";
import { appUrl, config, emailConfigured } from "../config.js";
import { audit, supabase } from "../db.js";
import { bot, ensureBotReady } from "../bot/instance.js";
import { forgetChatMemo } from "../bot/group.js";
import { closeResolution } from "../bot/lifecycle.js";
import { registerTelegramSurface, registerWebhook, webhookStatus } from "../bot/setup.js";
import { announceKeyboard, resolutionCard, resultsText, voteKeyboard } from "../bot/ui.js";
import { buildReport, emailReport, reportToCsv, reportToHtml } from "../report.js";
import { addDbAdmin, isAdminUser, listDbAdmins, removeDbAdmin } from "../services/admins.js";
import { credentialsCsv, generateCredentials, parsePeople, type CredentialRow, type Person } from "../services/credentials.js";
import { councilMembers, createCouncil, deleteCouncil, findCouncilByName, getCouncil, issueInvitations, listCouncils, reissuePasswords, updateCouncil } from "../services/councils.js";
import { ethiopicFontAvailable, invitationLink, invitationsPdf, type InvitationRow } from "../invitations.js";
import {
  findById,
  findByTelegramId,
  listMembers,
  listRegisteredTelegramIds,
  loginWithCredentials,
  memberCounts,
  setMemberActive,
  unbindById,
  unlockMember,
  type MemberFilter,
} from "../services/members.js";
import {
  createResolution,
  deleteResolution,
  getById,
  listResolutions,
  setAnnounceTarget,
  setStatus,
  updateResolution,
  type ResolutionPatch,
} from "../services/resolutions.js";
import {
  deleteTopic,
  getLinkedGroup,
  unlinkGroup,
  getTopic,
  listTopics,
  renameTopic,
  setSetting,
  upsertTopic,
} from "../services/settings.js";
import { ballotCount, castVote, memberBallots, memberChoices, tally } from "../services/votes.js";
import { formatLocal } from "../time.js";
import type { Member, Resolution, Threshold } from "../types.js";
import { computeOutcome } from "../verdict.js";
import { verifyInitData, type TgUser } from "./auth.js";
import { asObject, bool, HttpError, int, json, readJsonBody, str } from "./util.js";

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

interface Ctx {
  req: IncomingMessage;
  user: TgUser;
  isAdmin: boolean;
  query: URLSearchParams;
  startParam?: string;
  body(): Promise<Record<string, unknown>>;
}

type Handler = (ctx: Ctx, params: string[]) => Promise<unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  admin: boolean;
  handler: Handler;
}

const routes: Route[] = [];
const route = (method: string, pattern: string, admin: boolean, handler: Handler) =>
  routes.push({ method, pattern: new RegExp(`^${pattern}$`), admin, handler });

const UUID = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";

/** Entry point from the router. `path` is relative to /api/app. */
export async function handleAppApi(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
  query: URLSearchParams,
): Promise<void> {
  const auth = (req.headers.authorization ?? "").trim();
  if (!auth.toLowerCase().startsWith("tma ")) throw new HttpError(401, "Open this page inside Telegram.", "no_auth");
  const verified = verifyInitData(auth.slice(4).trim(), config.botToken);
  if (!verified) throw new HttpError(401, "Your session is invalid or expired. Close and reopen the app.", "bad_auth");

  await ensureBotReady();
  const isAdmin = await isAdminUser(verified.user.id);

  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.pattern.exec(path);
    if (!m) continue;
    if (r.admin && !isAdmin) throw new HttpError(403, "Admin access required.", "forbidden");
    let cached: Record<string, unknown> | null = null;
    const ctx: Ctx = {
      req,
      user: verified.user,
      isAdmin,
      query,
      startParam: verified.startParam,
      body: async () => (cached ??= asObject((await readJsonBody(req)) ?? {})),
    };
    const result = await r.handler(ctx, m.slice(1));
    json(res, 200, result ?? { ok: true });
    return;
  }
  throw new HttpError(404, `No route for ${method} ${path}`);
}

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

function safeMember(m: Member) {
  return {
    id: m.id,
    token_id: m.token_id,
    full_name: m.full_name,
    region: m.region,
    registered_at: m.registered_at,
    is_active: m.is_active,
    vote_weight: m.vote_weight ?? 1,
  };
}

/** A resolution enriched with ballot count and (optionally) the tally. */
async function enrich(res: Resolution, withCounts: boolean) {
  const ballots = await ballotCount(res.id);
  let counts: number[] | null = null;
  let outcome: ReturnType<typeof computeOutcome> | null = null;
  if (withCounts) {
    const rows = await tally(res.id);
    counts = res.options.map((_, i) => Number(rows.find((r) => r.choice_index === i)?.votes ?? 0));
    outcome = computeOutcome(res, counts, ballots);
  }
  return {
    ...res,
    ballots,
    counts,
    votes_total: counts ? counts.reduce((a, b) => a + b, 0) : null, // weighted
    outcome,
    closes_at_local: res.closes_at ? formatLocal(res.closes_at) : null,
    opened_at_local: res.opened_at ? formatLocal(res.opened_at) : null,
    closed_at_local: res.closed_at ? formatLocal(res.closed_at) : null,
  };
}

async function requireResolution(id: string): Promise<Resolution> {
  const res = await getById(id);
  if (!res) throw new HttpError(404, "Resolution not found.");
  return res;
}

function parseThreshold(v: unknown): Threshold {
  if (v === undefined || v === null || v === "") return "simple";
  if (v === "simple" || v === "two_thirds") return v;
  if (v === "2/3") return "two_thirds";
  throw new HttpError(400, "threshold must be 'simple' or 'two_thirds'");
}

function parseResolutionBody(b: Record<string, unknown>) {
  const title = str(b.title, "Title", { min: 3, max: 200 });
  const description = str(b.description, "Description", { optional: true, max: 2000 }) || null;
  if (!Array.isArray(b.options)) throw new HttpError(400, "options must be a list");
  const options = b.options.map((o, i) => str(o, `Option ${i + 1}`, { min: 1, max: 60 }));
  if (options.length < 2) throw new HttpError(400, "At least two options are required");
  if (options.length > 12) throw new HttpError(400, "At most 12 options are supported");
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
    throw new HttpError(400, "Options must be distinct");
  }
  return {
    title,
    description,
    options,
    anonymous: bool(b.anonymous, "anonymous", true),
    quorum: int(b.quorum, "Quorum", { optional: true, min: 1, max: 1_000_000 }),
    threshold: parseThreshold(b.threshold),
  };
}

/** Resolve where to post: explicit chat/thread, else the resolution's own target, else the linked group's General topic. */
async function resolveTarget(
  res: Resolution,
  b: Record<string, unknown>,
): Promise<{ chat_id: number; thread_id: number | null; label: string }> {
  const chatId = int(b.chat_id, "chat_id", { optional: true });
  if (chatId !== null) {
    const threadId = int(b.thread_id, "thread_id", { optional: true }) ?? 0;
    const topic = await getTopic(chatId, threadId);
    const label = topic?.name ?? (threadId === 0 ? "General" : `Topic ${threadId}`);
    return { chat_id: chatId, thread_id: threadId === 0 ? null : threadId, label };
  }
  if (res.announce_chat_id) {
    const topic = await getTopic(res.announce_chat_id, res.announce_thread_id ?? 0);
    return {
      chat_id: res.announce_chat_id,
      thread_id: res.announce_thread_id,
      label: topic?.name ?? "the announcement topic",
    };
  }
  const group = await getLinkedGroup();
  if (!group) throw new HttpError(400, "No assembly group is linked yet. Add the bot to the group as an admin, then choose a topic in Setup.", "no_group");
  return { chat_id: group.chat_id, thread_id: null, label: "General" };
}

const BATCH = 80; // DMs per request (~3 s at 40 ms spacing) — keeps serverless invocations short.

async function dmBatch(ids: number[], offset: number, send: (id: number) => Promise<unknown>) {
  const slice = ids.slice(offset, offset + BATCH);
  let sent = 0;
  let failed = 0;
  for (const id of slice) {
    try {
      await send(id);
      sent++;
    } catch {
      failed++; // member blocked the bot or never opened it
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  const next = offset + slice.length;
  return { sent, failed, total: ids.length, next_offset: next < ids.length ? next : null };
}

// ---------------------------------------------------------------------------
// Everyone (member + admin)
// ---------------------------------------------------------------------------

route("GET", "/me", false, async (ctx) => {
  const member = await findByTelegramId(ctx.user.id);
  return {
    user: ctx.user,
    role: ctx.isAdmin ? "admin" : member ? "member" : "guest",
    member: member ? safeMember(member) : null,
    start_param: ctx.startParam ?? null,
    app: {
      bot_username: bot.botInfo.username,
      tz_label: config.tzLabel,
      tz_offset_minutes: config.tzOffsetMinutes,
      email_configured: emailConfigured(),
      serverless: config.serverless,
    },
  };
});

route("POST", "/register", false, async (ctx) => {
  const b = await ctx.body();
  const token = str(b.token, "Token", { min: 3, max: 40 });
  const password = str(b.password, "Password", { min: 1, max: 100 });
  const existing = await findByTelegramId(ctx.user.id);
  if (existing) return { status: "ok", member: safeMember(existing), already: true };
  const result = await loginWithCredentials(token, password, ctx.user.id);
  if (result.status === "ok") return { status: "ok", member: safeMember(result.member) };
  return { status: result.status, lock_minutes: config.lockMinutes };
});

route("GET", "/ballots", false, async (ctx) => {
  const member = await findByTelegramId(ctx.user.id);
  const all = await listResolutions();
  const [voted, choices] = member
    ? await Promise.all([memberBallots(member.id), memberChoices(member.id)])
    : [new Set<string>(), new Map<string, number>()];

  const open = [];
  const closed = [];
  for (const res of all) {
    if (res.status === "open") {
      const e = await enrich(res, ctx.isAdmin);
      open.push({ ...e, voted: voted.has(res.id), my_choice: res.anonymous ? null : (choices.get(res.id) ?? null) });
    } else if (res.status === "closed") {
      closed.push({ ...(await enrich(res, true)), voted: voted.has(res.id) });
    }
  }
  return { open, closed: closed.reverse(), drafts: all.filter((r) => r.status === "draft").length, member: member ? safeMember(member) : null };
});

route("POST", "/vote", false, async (ctx) => {
  const b = await ctx.body();
  const member = await findByTelegramId(ctx.user.id);
  if (!member || !member.is_active) throw new HttpError(403, "Please register first.", "not_registered");
  const resolutionId = str(b.resolution_id, "resolution_id");
  const choice = int(b.choice_index, "choice_index", { min: 0, max: 50 })!;
  const res = await requireResolution(resolutionId);
  if (res.options[choice] === undefined) throw new HttpError(400, "Unknown option.");
  const outcome = await castVote(res.id, member.id, choice);
  if (outcome === "ok") await audit(ctx.user.id, "vote_cast", { resolution: res.code, anonymous: res.anonymous, via: "app" });
  if (outcome === "changed") await audit(ctx.user.id, "vote_changed", { resolution: res.code, via: "app" });
  return { result: outcome, option: res.options[choice], anonymous: res.anonymous };
});

route("GET", `/results/${UUID}`, false, async (ctx, [id]) => {
  const res = await requireResolution(id);
  if (res.status !== "closed" && !ctx.isAdmin) throw new HttpError(403, "Results are published when voting closes.");
  return enrich(res, true);
});

// ---------------------------------------------------------------------------
// Admin: dashboard & resolutions
// ---------------------------------------------------------------------------

route("GET", "/dashboard", true, async () => {
  const [counts, all, group] = await Promise.all([memberCounts(), listResolutions(), getLinkedGroup()]);
  const resolutions = await Promise.all(all.map((r) => enrich(r, r.status !== "draft")));
  return {
    members: counts,
    resolutions,
    group,
    app_url: appUrl(),
    summary: {
      draft: all.filter((r) => r.status === "draft").length,
      open: all.filter((r) => r.status === "open").length,
      closed: all.filter((r) => r.status === "closed").length,
    },
  };
});

route("GET", "/resolutions", true, async () => {
  const all = await listResolutions();
  return { items: await Promise.all(all.map((r) => enrich(r, r.status !== "draft"))) };
});

route("POST", "/resolutions", true, async (ctx) => {
  const input = parseResolutionBody(await ctx.body());
  const res = await createResolution({
    title: input.title,
    description: input.description,
    options: input.options,
    anonymous: input.anonymous,
  });
  const patch: ResolutionPatch = {};
  if (input.quorum !== null) patch.quorum = input.quorum;
  if (input.threshold !== "simple") patch.threshold = input.threshold;
  if (Object.keys(patch).length) await updateResolution(res.id, patch);
  await audit(ctx.user.id, "resolution_created", { code: res.code, title: res.title, via: "app" });
  return enrich((await getById(res.id))!, false);
});

route("GET", `/resolutions/${UUID}`, true, async (_ctx, [id]) => {
  const res = await requireResolution(id);
  const [e, topics] = await Promise.all([enrich(res, res.status !== "draft"), listTopics()]);
  return { ...e, topics };
});

route("PATCH", `/resolutions/${UUID}`, true, async (ctx, [id]) => {
  const res = await requireResolution(id);
  if (res.status !== "draft") throw new HttpError(409, "Only drafts can be edited.");
  const input = parseResolutionBody(await ctx.body());
  const ok = await updateResolution(res.id, input);
  if (!ok) throw new HttpError(409, "The resolution is no longer a draft.");
  await audit(ctx.user.id, "resolution_edited", { code: res.code, via: "app" });
  return enrich((await getById(res.id))!, false);
});

route("DELETE", `/resolutions/${UUID}`, true, async (ctx, [id]) => {
  const res = await requireResolution(id);
  if (res.status !== "draft") throw new HttpError(409, "Only drafts can be deleted.");
  const ok = await deleteResolution(res.id);
  if (!ok) throw new HttpError(409, "The resolution is no longer a draft.");
  await audit(ctx.user.id, "resolution_deleted", { code: res.code, via: "app" });
  return { ok: true };
});

route("POST", `/resolutions/${UUID}/open`, true, async (ctx, [id]) => {
  const res = await requireResolution(id);
  if (res.status === "closed") throw new HttpError(409, "A closed resolution cannot be reopened. Create a new one.");
  if (res.status === "open") throw new HttpError(409, "Voting is already open.");
  const b = await ctx.body();
  let closesAt: Date | null = null;
  const minutes = int(b.minutes, "minutes", { optional: true, min: 1, max: 60 * 24 * 30 });
  if (minutes !== null) closesAt = new Date(Date.now() + minutes * 60_000);
  else if (b.closes_at) {
    const d = new Date(String(b.closes_at));
    if (Number.isNaN(d.getTime())) throw new HttpError(400, "Invalid deadline.");
    if (d.getTime() <= Date.now() + 30_000) throw new HttpError(400, "The deadline must be in the future.");
    closesAt = d;
  }
  await setStatus(res.id, "open", closesAt);
  await audit(ctx.user.id, "resolution_opened", { code: res.code, closes_at: closesAt?.toISOString() ?? null, via: "app" });
  return enrich((await getById(res.id))!, true);
});

route("POST", `/resolutions/${UUID}/close`, true, async (ctx, [id]) => {
  const res = await requireResolution(id);
  if (res.status !== "open") throw new HttpError(409, "Voting is not open.");
  const text = await closeResolution(bot.api, res, ctx.user.id);
  if (!text) throw new HttpError(409, "The resolution was already closed.");
  return { ...(await enrich((await getById(res.id))!, true)), published: Boolean(res.announce_chat_id) };
});

route("POST", `/resolutions/${UUID}/announce`, true, async (ctx, [id]) => {
  const res = await requireResolution(id);
  if (res.status === "draft") throw new HttpError(409, "Open voting before announcing, so members can vote right away.");
  const target = await resolveTarget(res, await ctx.body());
  try {
    await bot.api.sendMessage(target.chat_id, resolutionCard(res), {
      parse_mode: "HTML",
      message_thread_id: target.thread_id ?? undefined,
      reply_markup: announceKeyboard(res, bot.botInfo.username),
    });
  } catch (err) {
    throw new HttpError(502, `Telegram refused the message: ${(err as Error).message}. Is the bot still an admin of the group?`);
  }
  await setAnnounceTarget(res.id, target.chat_id, target.thread_id);
  await audit(ctx.user.id, "resolution_announced", { code: res.code, chat_id: target.chat_id, thread_id: target.thread_id, via: "app" });
  return { ok: true, posted_to: target.label };
});

/** Post the (interim or final) results to a topic — useful when results must be shown again or elsewhere. */
route("POST", `/resolutions/${UUID}/publish`, true, async (ctx, [id]) => {
  const res = await requireResolution(id);
  if (res.status === "draft") throw new HttpError(409, "No results yet.");
  const target = await resolveTarget(res, await ctx.body());
  const [rows, ballots] = await Promise.all([tally(res.id), ballotCount(res.id)]);
  try {
    await bot.api.sendMessage(target.chat_id, resultsText(res, rows, ballots), {
      parse_mode: "HTML",
      message_thread_id: target.thread_id ?? undefined,
    });
  } catch (err) {
    throw new HttpError(502, `Telegram refused the message: ${(err as Error).message}`);
  }
  await audit(ctx.user.id, "results_published", { code: res.code, final: res.status === "closed", via: "app" });
  return { ok: true, posted_to: target.label };
});

/** DM the ballot card to every registered member, in batches (call again with next_offset). */
route("POST", `/resolutions/${UUID}/notify`, true, async (ctx, [id]) => {
  const res = await requireResolution(id);
  if (res.status !== "open") throw new HttpError(409, "Voting is not open.");
  const b = await ctx.body();
  const offset = int(b.offset, "offset", { optional: true, min: 0 }) ?? 0;
  const ids = await listRegisteredTelegramIds();
  const result = await dmBatch(ids, offset, (uid) =>
    bot.api.sendMessage(uid, resolutionCard(res), { parse_mode: "HTML", reply_markup: voteKeyboard(res) }),
  );
  if (result.next_offset === null) await audit(ctx.user.id, "ballot_notified", { code: res.code, total: result.total, via: "app" });
  return result;
});

// ---------------------------------------------------------------------------
// Admin: members
// ---------------------------------------------------------------------------

route("GET", "/members", true, async (ctx) => {
  const filter = (ctx.query.get("filter") ?? "all") as MemberFilter;
  const page = Number(ctx.query.get("page") ?? 0) || 0;
  const { items, total } = await listMembers({ q: ctx.query.get("q") ?? "", filter, page, pageSize: 50 });
  const now = Date.now();
  return {
    total,
    page,
    page_size: 50,
    counts: await memberCounts(),
    items: items.map((m) => ({ ...m, locked: m.locked_until !== null && new Date(m.locked_until).getTime() > now })),
  };
});

route("POST", `/members/${UUID}/unbind`, true, async (ctx, [id]) => {
  const m = await findById(id);
  if (!m) throw new HttpError(404, "Member not found.");
  await unbindById(id);
  await audit(ctx.user.id, "unbind", { token: m.token_id, ok: true, via: "app" });
  return { ok: true };
});

route("POST", `/members/${UUID}/unlock`, true, async (ctx, [id]) => {
  const m = await findById(id);
  if (!m) throw new HttpError(404, "Member not found.");
  await unlockMember(id);
  await audit(ctx.user.id, "member_unlocked", { token: m.token_id, via: "app" });
  return { ok: true };
});

route("POST", `/members/${UUID}/active`, true, async (ctx, [id]) => {
  const m = await findById(id);
  if (!m) throw new HttpError(404, "Member not found.");
  const active = bool((await ctx.body()).active, "active", !m.is_active);
  await setMemberActive(id, active);
  await audit(ctx.user.id, active ? "member_activated" : "member_deactivated", { token: m.token_id, via: "app" });
  return { ok: true, is_active: active };
});

/**
 * Generate credentials. Capped per request (bcrypt is deliberately slow);
 * the client loops over larger lists and then asks for a single CSV file.
 */
route("POST", "/members/generate", true, async (ctx) => {
  const b = await ctx.body();
  const prefix = str(b.prefix, "Prefix", { optional: true, max: 20 }) || "ESA-2026";
  let people: Person[];
  if (Array.isArray(b.people)) {
    people = b.people.map((p) => {
      const o = asObject(p);
      return {
        name: str(o.name, "Name", { optional: true, max: 120 }) || null,
        region: str(o.region, "Region", { optional: true, max: 120 }) || null,
      };
    });
  } else if (typeof b.names_text === "string") {
    people = parsePeople(b.names_text);
  } else {
    const count = int(b.count, "Count", { min: 1, max: 50 })!;
    people = Array.from({ length: count }, () => ({ name: null, region: null }));
  }
  if (people.length === 0) throw new HttpError(400, "Nobody to generate credentials for.");
  if (people.length > 50) throw new HttpError(400, "At most 50 per request; the app sends larger lists in batches.");
  const rows = await generateCredentials(people, prefix);
  await audit(ctx.user.id, "credentials_generated", { count: rows.length, prefix, via: "app" });
  return { rows };
});

/** Deliver the plaintext credentials as one CSV file to the admin's private chat. */
route("POST", "/members/credentials-file", true, async (ctx) => {
  const b = await ctx.body();
  if (!Array.isArray(b.rows) || b.rows.length === 0) throw new HttpError(400, "rows is required");
  if (b.rows.length > 5000) throw new HttpError(400, "Too many rows");
  const rows: CredentialRow[] = b.rows.map((r) => {
    const o = asObject(r);
    return {
      token_id: str(o.token_id, "token_id", { max: 40 }),
      password: str(o.password, "password", { max: 40 }),
      full_name: str(o.full_name, "full_name", { optional: true, max: 120 }) || null,
      region: str(o.region, "region", { optional: true, max: 120 }) || null,
    };
  });
  const stamp = formatLocal(new Date()).replace(/[: ]/g, "-");
  try {
    await bot.api.sendDocument(ctx.user.id, new InputFile(Buffer.from(credentialsCsv(rows), "utf8"), `esa-credentials-${stamp}.csv`), {
      caption:
        `🔐 ${rows.length} credential(s). This is the ONLY copy of the passwords. ` +
        "Distribute one row per member through a secure channel, then delete this file from the chat.",
    });
  } catch (err) {
    throw new HttpError(502, `Could not send the file to your chat: ${(err as Error).message}. Send /start to the bot first.`);
  }
  return { ok: true, count: rows.length };
});

/** DM all registered members, in batches (call again with next_offset). */
route("POST", "/broadcast", true, async (ctx) => {
  const b = await ctx.body();
  const message = str(b.text, "Message", { min: 1, max: 3500 });
  const offset = int(b.offset, "offset", { optional: true, min: 0 }) ?? 0;
  const ids = await listRegisteredTelegramIds();
  const result = await dmBatch(ids, offset, (uid) => bot.api.sendMessage(uid, `📣 ${message}`));
  if (result.next_offset === null) await audit(ctx.user.id, "broadcast", { total: result.total, via: "app" });
  return result;
});


// ---------------------------------------------------------------------------
// Admin: councils & invitations
// ---------------------------------------------------------------------------

const INVITE_BATCH = 40; // bcrypt per row; the app loops over larger lists

function invitationRows(b: Record<string, unknown>): InvitationRow[] {
  if (!Array.isArray(b.rows) || b.rows.length === 0) throw new HttpError(400, "rows is required");
  if (b.rows.length > 2000) throw new HttpError(400, "Too many rows");
  return b.rows.map((r) => {
    const o = asObject(r);
    return {
      token_id: str(o.token_id, "token_id", { max: 40 }),
      password: str(o.password, "password", { max: 40 }),
      full_name: str(o.full_name, "full_name", { optional: true, max: 120 }) || null,
      seat_no: int(o.seat_no, "seat_no", { optional: true, min: 1 }),
    };
  });
}

async function requireCouncil(id: string) {
  const c = await getCouncil(id);
  if (!c) throw new HttpError(404, "Council not found.");
  return c;
}

route("GET", "/councils", true, async () => ({
  items: await listCouncils(),
  bot_username: bot.botInfo.username,
  amharic_pdf: ethiopicFontAvailable(),
}));

/** Create a council; with upsert=true an existing council of the same name is reused (seats raised if needed). */
route("POST", "/councils", true, async (ctx) => {
  const b = await ctx.body();
  const name = str(b.name, "Council name", { min: 2, max: 120 });
  const seats = int(b.seats, "Seats", { min: 1, max: 1000 })!;
  const voteWeight = int(b.vote_weight, "Votes per delegate", { optional: true, min: 1, max: 100 });
  const code = str(b.code, "Code", { optional: true, max: 6 }) || null;
  const existing = await findCouncilByName(name);
  if (existing) {
    if (!bool(b.upsert, "upsert", false)) throw new HttpError(409, "A council with this name already exists.", "exists");
    const patch: { seats?: number; vote_weight?: number } = {};
    if (seats > existing.seats) patch.seats = seats;
    if (voteWeight !== null && voteWeight !== existing.vote_weight) patch.vote_weight = voteWeight;
    if (Object.keys(patch).length) await updateCouncil(existing.id, patch);
    return { council: await getCouncil(existing.id), created: false };
  }
  const c = await createCouncil({ name, seats, code, vote_weight: voteWeight ?? 1 });
  await audit(ctx.user.id, "council_created", { name: c.name, code: c.code, seats: c.seats, vote_weight: c.vote_weight, via: "app" });
  return { council: await getCouncil(c.id), created: true };
});

route("GET", `/councils/${UUID}`, true, async (_ctx, [id]) => {
  const council = await requireCouncil(id);
  const members = await councilMembers(id);
  const now = Date.now();
  return {
    council,
    invitations: members.map((m) => ({
      ...m,
      locked: m.locked_until !== null && new Date(m.locked_until).getTime() > now,
      link: invitationLink(bot.botInfo.username, m.token_id),
    })),
    bot_username: bot.botInfo.username,
    amharic_pdf: ethiopicFontAvailable(),
  };
});

route("PATCH", `/councils/${UUID}`, true, async (ctx, [id]) => {
  await requireCouncil(id);
  const b = await ctx.body();
  const patch: { name?: string; seats?: number; vote_weight?: number } = {};
  const name = str(b.name, "Council name", { optional: true, min: 2, max: 120 });
  if (name) {
    const clash = await findCouncilByName(name);
    if (clash && clash.id !== id) throw new HttpError(409, "A council with this name already exists.", "exists");
    patch.name = name;
  }
  const seats = int(b.seats, "Seats", { optional: true, min: 1, max: 1000 });
  if (seats !== null) patch.seats = seats;
  const voteWeight = int(b.vote_weight, "Votes per delegate", { optional: true, min: 1, max: 100 });
  if (voteWeight !== null) patch.vote_weight = voteWeight;
  await updateCouncil(id, patch);
  await audit(ctx.user.id, "council_edited", { council_id: id, ...patch, via: "app" });
  return { council: await getCouncil(id) };
});

route("DELETE", `/councils/${UUID}`, true, async (ctx, [id]) => {
  const c = await requireCouncil(id);
  const ok = await deleteCouncil(id);
  if (!ok) throw new HttpError(409, "This council already has invitations; deactivate them under Members instead.", "has_members");
  await audit(ctx.user.id, "council_deleted", { name: c.name, via: "app" });
  return { ok: true };
});

/** Issue invitations: names (one per delegate, empty = anonymous seat) or a count. Max 40 per request. */
route("POST", `/councils/${UUID}/invitations`, true, async (ctx, [id]) => {
  const c = await requireCouncil(id);
  const b = await ctx.body();
  let names: (string | null)[];
  if (Array.isArray(b.names)) {
    names = b.names.map((n, i) => str(n, `Name ${i + 1}`, { optional: true, max: 120 }) || null);
  } else {
    const count = int(b.count, "Count", { min: 1, max: INVITE_BATCH })!;
    names = Array.from({ length: count }, () => null);
  }
  if (names.length === 0) throw new HttpError(400, "Nobody to invite.");
  if (names.length > INVITE_BATCH) throw new HttpError(400, `At most ${INVITE_BATCH} per request; the app sends larger lists in batches.`);
  const rows = await issueInvitations(c, names);
  await audit(ctx.user.id, "invitations_issued", { council: c.name, count: rows.length, via: "app" });
  return { rows, council: await getCouncil(id) };
});

/** Fresh passwords for every invitation of the council that is not registered yet (lost sheet). */
route("POST", `/councils/${UUID}/reissue`, true, async (ctx, [id]) => {
  const c = await requireCouncil(id);
  const rows = await reissuePasswords(c);
  await audit(ctx.user.id, "invitations_reissued", { council: c.name, count: rows.length, via: "app" });
  return { rows, council: await getCouncil(id) };
});

/** Build the printable PDF (QR + link per invitation) and send it to the admin chat. */
route("POST", `/councils/${UUID}/invitations-pdf`, true, async (ctx, [id]) => {
  const c = await requireCouncil(id);
  const rows = invitationRows(await ctx.body());
  const pdf = await invitationsPdf({ council: c, rows, botUsername: bot.botInfo.username });
  const stamp = formatLocal(new Date()).replace(/[: ]/g, "-");
  const file = `esa-invitations-${c.code.toLowerCase()}-${stamp}.pdf`;
  try {
    await bot.api.sendDocument(ctx.user.id, new InputFile(pdf, file), {
      caption:
        `🎫 ${rows.length} invitation(s) for ${c.name}. Print it (two per page, cut along the line) or forward the PDF to the council. ` +
        "It contains the passwords: delete it from the chat once the invitations are handed over.",
    });
  } catch (err) {
    throw new HttpError(502, `Could not send the file to your chat: ${(err as Error).message}. Send /start to the bot first.`);
  }
  await audit(ctx.user.id, "invitations_pdf_sent", { council: c.name, count: rows.length, via: "app" });
  return { ok: true, count: rows.length, file };
});

// ---------------------------------------------------------------------------
// Admin: report
// ---------------------------------------------------------------------------

route("POST", "/report", true, async (ctx) => {
  const wantEmail = bool((await ctx.body()).email, "email", false);
  if (wantEmail && !emailConfigured()) {
    throw new HttpError(400, "Email delivery is not configured (RESEND_API_KEY, REPORT_EMAIL_FROM, REPORT_EMAIL_TO).");
  }
  const report = await buildReport();
  const csv = reportToCsv(report);
  const html = reportToHtml(report);
  const stamp = formatLocal(report.generatedAt).replace(/[: ]/g, "-");
  try {
    await bot.api.sendDocument(ctx.user.id, new InputFile(Buffer.from(csv, "utf8"), `esa-voting-report-${stamp}.csv`), {
      caption: "Raw data — opens in Excel / Google Sheets.",
    });
    await bot.api.sendDocument(ctx.user.id, new InputFile(Buffer.from(html, "utf8"), `esa-voting-report-${stamp}.html`), {
      caption: "Formatted report — open in a browser, print to PDF if needed.",
    });
  } catch (err) {
    throw new HttpError(502, `Could not send the files to your chat: ${(err as Error).message}. Send /start to the bot first.`);
  }
  let emailedTo: string | null = null;
  let emailError: string | null = null;
  if (wantEmail) {
    try {
      emailedTo = await emailReport(html, csv);
    } catch (err) {
      console.error("report email failed:", err);
      emailError = "Email delivery failed — check the server logs. The files in your chat are still valid.";
    }
  }
  await audit(ctx.user.id, "report_generated", { emailed: Boolean(emailedTo), via: "app" });
  return { ok: true, emailed_to: emailedTo, email_error: emailError, resolutions: report.sections.length };
});

// ---------------------------------------------------------------------------
// Admin: setup
// ---------------------------------------------------------------------------

const TABLES = ["members", "resolutions", "ballots", "votes", "audit_log", "app_settings", "chat_topics", "admins", "councils"];

async function dbStatus(): Promise<{ ok: boolean; missing: string[] }> {
  const missing: string[] = [];
  await Promise.all(
    TABLES.map(async (t) => {
      const { error } = await supabase.from(t).select("*", { count: "exact", head: true });
      if (error) missing.push(t);
    }),
  );
  return { ok: missing.length === 0, missing };
}

route("GET", "/setup", true, async (ctx) => {
  let [group, topics] = await Promise.all([getLinkedGroup(), listTopics()]);
  const [dbAdmins, db] = await Promise.all([listDbAdmins().catch(() => []), dbStatus()]);
  let webhook = null;
  let webhookError: string | null = null;
  try {
    webhook = await webhookStatus(bot);
  } catch (err) {
    webhookError = (err as Error).message;
  }
  // How the bot stands in the linked group, so the admin can see why a topic
  // rename stayed app-side (it needs the "Manage topics" administrator right).
  let groupRights: { status: string; is_admin: boolean; can_manage_topics: boolean; can_delete_messages: boolean; can_pin_messages: boolean } | null = null;
  if (group?.chat_id) {
    const linkedChatId = group.chat_id;
    const forget = async (reason: string) => {
      // The bot was removed while we were not listening: forget the group now.
      await unlinkGroup(linkedChatId);
      forgetChatMemo(linkedChatId);
      await audit(ctx.user.id, "group_unlinked", { chat_id: linkedChatId, via: "membership_check", reason });
      group = null;
      topics = [];
    };
    try {
      const m = (await bot.api.getChatMember(linkedChatId, bot.botInfo.id)) as unknown as Record<string, unknown>;
      const status = String(m.status);
      if (status === "left" || status === "kicked") {
        await forget(status);
      } else {
        const owner = status === "creator";
        const isAdmin = owner || status === "administrator";
        groupRights = {
          status,
          is_admin: isAdmin,
          can_manage_topics: owner || (isAdmin && Boolean(m.can_manage_topics)),
          can_delete_messages: owner || (isAdmin && Boolean(m.can_delete_messages)),
          can_pin_messages: owner || (isAdmin && Boolean(m.can_pin_messages)),
        };
      }
    } catch (err) {
      // Telegram answers for a removed bot with an error rather than a "left"
      // member: 403 "bot was kicked from the supergroup chat" / "bot is not a
      // member of the supergroup chat", or 400 "chat not found".
      const msg = (err as Error).message ?? String(err);
      if (/kicked|not a member|chat not found|Forbidden/i.test(msg)) await forget(msg);
      groupRights = null;
    }
  }
  return {
    group_rights: groupRights,
    mode: config.serverless ? "serverless" : "server",
    polling: !config.publicUrl,
    public_url: config.publicUrl,
    app_url: appUrl(),
    bot: { id: bot.botInfo.id, username: bot.botInfo.username, name: bot.botInfo.first_name },
    webhook,
    webhook_error: webhookError,
    webhook_secret_set: Boolean(config.webhookSecret),
    cron_secret_set: Boolean(config.cronSecret),
    tick_path: "/api/tick?key=<CRON_SECRET or WEBHOOK_SECRET>",
    group,
    topics,
    admins: { env: config.adminIds, db: dbAdmins },
    email_configured: emailConfigured(),
    tz: { label: config.tzLabel, offset_minutes: config.tzOffsetMinutes },
    db,
  };
});

route("POST", "/setup/webhook", true, async (ctx) => {
  if (!config.publicUrl) throw new HttpError(400, "No public URL configured; the bot is in long-polling mode.");
  await registerTelegramSurface(bot);
  const status = await registerWebhook(bot);
  await audit(ctx.user.id, "webhook_registered", { url: status.expected, via: "app" });
  return status;
});

route("POST", "/setup/menu", true, async () => {
  await registerTelegramSurface(bot);
  return { ok: true, app_url: appUrl() };
});

route("POST", "/setup/admins", true, async (ctx) => {
  const b = await ctx.body();
  const id = int(b.telegram_user_id, "Telegram ID", { min: 1 })!;
  const name = str(b.name, "Name", { optional: true, max: 120 }) || null;
  await addDbAdmin(id, name, ctx.user.id);
  await audit(ctx.user.id, "admin_added", { telegram_user_id: id, name, via: "app" });
  return { ok: true };
});

route("DELETE", "/setup/admins/(\\d+)", true, async (ctx, [idStr]) => {
  const id = Number(idStr);
  if (config.adminIds.includes(id)) throw new HttpError(409, "This admin comes from ADMIN_TELEGRAM_IDS; remove it there.");
  if (id === ctx.user.id) throw new HttpError(409, "You cannot remove yourself.");
  await removeDbAdmin(id);
  await audit(ctx.user.id, "admin_removed", { telegram_user_id: id, via: "app" });
  return { ok: true };
});

route("POST", "/setup/group", true, async (ctx) => {
  const b = await ctx.body();
  const chatId = int(b.chat_id, "chat_id")!;
  const title = str(b.title, "Title", { optional: true, max: 200 }) || null;
  await setSetting("group", { chat_id: chatId, title });
  await upsertTopic({ chat_id: chatId, thread_id: 0, name: "General", chat_title: title });
  await audit(ctx.user.id, "group_linked", { chat_id: chatId, via: "app" });
  return { ok: true };
});

route("DELETE", "/setup/group", true, async (ctx) => {
  const group = await getLinkedGroup();
  await unlinkGroup();
  if (group) forgetChatMemo(group.chat_id);
  await audit(ctx.user.id, "group_unlinked", { chat_id: group?.chat_id ?? null, via: "app" });
  return { ok: true };
});

route("POST", "/setup/topics", true, async (ctx) => {
  const b = await ctx.body();
  const chatId = int(b.chat_id, "chat_id")!;
  const threadId = int(b.thread_id, "thread_id", { min: 0 })!;
  const name = str(b.name, "Name", { min: 1, max: 128 });
  await upsertTopic({ chat_id: chatId, thread_id: threadId, name });
  return { ok: true };
});

route("PATCH", "/setup/topics/(-?\\d+)/(\\d+)", true, async (ctx, [chat, thread]) => {
  const name = str((await ctx.body()).name, "Name", { min: 1, max: 128 });
  const chatId = Number(chat);
  const threadId = Number(thread);
  await renameTopic(chatId, threadId, name);
  // Rename the forum topic in the group as well. Telegram only allows this when
  // the bot is an administrator with the "Manage topics" right; otherwise the
  // new name stays an app-side label and the client tells the admin why.
  let telegram = false;
  let reason: string | null = null;
  let code: "no_rights" | "error" | null = null;
  try {
    if (threadId === 0) await bot.api.editGeneralForumTopic(chatId, name);
    else await bot.api.editForumTopic(chatId, threadId, { name });
    telegram = true;
  } catch (err) {
    reason = (err as Error).message ?? String(err);
    code = /rights|CHAT_ADMIN_REQUIRED|administrator/i.test(reason) ? "no_rights" : "error";
  }
  await audit(ctx.user.id, "topic_renamed", { chat_id: chatId, thread_id: threadId, name, telegram, reason, via: "app" });
  return { ok: true, telegram, reason, code };
});

route("DELETE", "/setup/topics/(-?\\d+)/(\\d+)", true, async (_ctx, [chat, thread]) => {
  await deleteTopic(Number(chat), Number(thread));
  return { ok: true };
});

route("POST", "/setup/test-message", true, async (ctx) => {
  const b = await ctx.body();
  const chatId = int(b.chat_id, "chat_id")!;
  const threadId = int(b.thread_id, "thread_id", { optional: true, min: 0 }) ?? 0;
  try {
    await bot.api.sendMessage(chatId, `✅ Test message from the admin panel (${ctx.user.first_name}).`, {
      message_thread_id: threadId || undefined,
    });
  } catch (err) {
    throw new HttpError(502, `Telegram refused the message: ${(err as Error).message}`);
  }
  return { ok: true };
});

route("GET", "/audit", true, async (ctx) => {
  const limit = Math.min(200, Math.max(1, Number(ctx.query.get("limit") ?? 50) || 50));
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, actor, action, details, created_at")
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return { items: (data ?? []).map((r) => ({ ...r, created_at_local: formatLocal(r.created_at as string) })) };
});
