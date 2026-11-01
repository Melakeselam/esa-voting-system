import type { IncomingMessage, ServerResponse } from "node:http";
import { InputFile, InputMediaBuilder } from "grammy";
import { appUrl, config, emailConfigured } from "../config.js";
import { audit, supabase } from "../db.js";
import { bot, ensureBotReady } from "../bot/instance.js";
import { forgetChatMemo, getLastUpdate } from "../bot/group.js";
import { lockGroupPermissions, readLockState, type GroupLockState } from "../bot/group-lock.js";
import { approveJoin, approvePendingJoin, declineJoin, ensureSignInTopic, kickFromGroup, unregisteredPeople } from "../bot/gate.js";
import { getGateMode, getPerson, personName, setGateMode } from "../services/group-people.js";
import { bindTelegram, findByToken } from "../services/members.js";
import { clearInvitation, pendingInvitation } from "../services/pending.js";
import { afterRegistrationKeyboard, groupInviteLink } from "../bot/group-link.js";
import { ensureCommandTopic, postKeyboard, setTopicReadOnly } from "../bot/group-commands.js";
import { afterMotionVoteCancelled, afterMotionVoteReopened, noteInTopic, postMotionCard, refreshMotionCard, tellAdminsSeconded } from "../bot/motions.js";
import {
  amendmentsOf,
  closeMotion,
  createMotion,
  getMotion,
  getMotionRules,
  listMotions,
  memberName,
  PENDING,
  PendingAmendmentsError,
  putToVote,
  rewordMotion,
  secondMotion,
  setMotionRules,
  stateMotion,
  withdrawMotion,
} from "../services/motions.js";
import { getLang, isSignedIn, PRESENCES, presenceCounts, setAvatar, setLang, setPresence, type Lang } from "../services/presence.js";
import { closeWaiting, extendVote } from "../bot/quorum-flow.js";
import { assemblySummary, getResetMode, resetAssembly, setResetMode } from "../services/reset.js";
import { closeResolution } from "../bot/lifecycle.js";
import { registerTelegramSurface, registerWebhook, webhookStatus } from "../bot/setup.js";
import { announceKeyboard, appKeyboard, escapeHtml, resolutionCard, resultsText, voteKeyboard } from "../bot/ui.js";
import { buildReport, emailReport, reportToCsv, reportToHtml } from "../report.js";
import { addDbAdmin, isAdminUser, listDbAdmins, removeDbAdmin } from "../services/admins.js";
import { credentialsCsv, generateCredentials, normalizePhone, parsePeople, type CredentialRow, type Person } from "../services/credentials.js";
import { councilMembers, createCouncil, deleteCouncil, findCouncilByName, getCouncil, issueInvitations, listCouncils, occupiedSeats, reissuePasswords, SeatsFullError, updateCouncil, type DelegateEntry } from "../services/councils.js";
import { ethiopicFontAvailable, invitationLink, invitationsPdf, type InvitationRow } from "../invitations.js";
import { TEMPLATE_KINDS, templateFile, type TemplateKind } from "../templates.js";
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
  regenerateActivationCode,
  listResolutions,
  setAnnounceTarget,
  setStatus,
  reopenResolution,
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
  setLinkedGroup,
  upsertTopic,
} from "../services/settings.js";
import { ballotCount, castVote, memberBallots, memberChoices, tally } from "../services/votes.js";
import { activate, activationCount, needsActivation } from "../services/activation.js";
import { formatLocal } from "../time.js";
import type { Council, Member, Motion, MotionKind, Resolution, Threshold } from "../types.js";
import { computeOutcome } from "../verdict.js";
import { eligibleFor } from "../services/resolutions.js";
import { verifyInitData, type TgUser } from "./auth.js";
import { requireOrgId, withOrg } from "../org-context.js";
import {
  brandedName,
  createOrg,
  defaultCodePrefix,
  orgWords,
  currentOrg,
  getOrg,
  GROUP_TERMS,
  isPlatformAdmin,
  listOrgs,
  resolveUserOrg,
  setActiveOrg,
  updateOrg,
  userOrgIds,
  VOTER_TERMS,
  PLATFORM_NAME,
  type OrgInput,
} from "../services/orgs.js";
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

  // Which organisation this request is about: the one the app asks for (if the
  // person belongs to it), else their chosen / only one, else — while the
  // platform serves a single organisation — that one.
  const requested = String(req.headers["x-org-id"] ?? "").trim() || null;
  const orgId = await resolveUserOrg(verified.user.id, requested);

  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.pattern.exec(path);
    if (!m) continue;
    return withOrg(orgId, async () => {
      if (!orgId && !ORGLESS.some((p) => p.test(path))) {
        throw new HttpError(409, "Choose an organisation first.", "org_required");
      }
      const isAdmin = await isAdminUser(verified.user.id);
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
    });
  }
  throw new HttpError(404, `No route for ${method} ${path}`);
}

/** Routes that work without an organisation (they pick one themselves, or manage organisations). */
const ORGLESS = [/^\/me$/, /^\/register$/, /^\/register\/pending$/, /^\/orgs(\/.*)?$/];

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
    presence: m.presence ?? "available",
  };
}

/**
 * A resolution enriched with ballot count and (optionally) the tally. The
 * activation code is included for admins only — members must get it from the
 * meeting, never from the API.
 */
async function enrich(res: Resolution, withCounts: boolean, admin = false) {
  const ballots = await ballotCount(res.id);
  let counts: number[] | null = null;
  let outcome: ReturnType<typeof computeOutcome> | null = null;
  if (withCounts) {
    const rows = await tally(res.id);
    counts = res.options.map((_, i) => Number(rows.find((r) => r.choice_index === i)?.votes ?? 0));
    outcome = computeOutcome(res, counts, ballots, await eligibleFor(res));
  }
  const { activation_code: code, ...pub } = res;
  return {
    ...pub,
    ...(admin ? { activation_code: code, activations: res.activation_required ? await activationCount(res.id) : 0 } : {}),
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
    quorum: int(b.quorum, "Quorum (%)", { optional: true, min: 1, max: 100 }),
    threshold: parseThreshold(b.threshold),
    activation_required: bool(b.activation_required, "activation_required", true),
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

/** Organisation as the app shows it: names, terms and the person's role in it. */
async function orgSummary(id: string, telegramId: number) {
  const o = await getOrg(id);
  if (!o) return null;
  const mine = await userOrgIds(telegramId);
  return {
    id: o.id,
    name_en: o.name_en,
    name_am: o.name_am,
    branded: brandedName(o),
    short_code: o.short_code,
    assembly_en: o.assembly_en,
    assembly_am: o.assembly_am,
    office_en: o.office_en,
    office_am: o.office_am,
    voter_term: o.voter_term,
    group_term: o.group_term,
    structure: o.structure ?? "councils",
    terms: { voter: VOTER_TERMS[o.voter_term] ?? VOTER_TERMS.delegate, group: GROUP_TERMS[o.group_term] ?? GROUP_TERMS.council },
    role: mine.admin.includes(o.id) ? "admin" : mine.member.includes(o.id) ? "member" : "guest",
  };
}

route("GET", "/me", false, async (ctx) => {
  const member = await findByTelegramId(ctx.user.id);
  const mine = await userOrgIds(ctx.user.id);
  const ids = [...new Set([...mine.admin, ...mine.member])];
  const orgs = (await Promise.all(ids.map((id) => orgSummary(id, ctx.user.id)))).filter(Boolean);
  const org = await currentOrg();
  return {
    user: ctx.user,
    role: ctx.isAdmin ? "admin" : member ? "member" : "guest",
    member: member ? safeMember(member) : null,
    avatar: member?.avatar ?? null,
    lang: await getLang(ctx.user.id),
    start_param: ctx.startParam ?? null,
    platform: { name: PLATFORM_NAME, admin: isPlatformAdmin(ctx.user.id) },
    org: org ? await orgSummary(org.id, ctx.user.id) : null,
    orgs,
    org_required: !org && orgs.length > 1,
    group_link: org && (member || ctx.isAdmin) ? await groupInviteLink(bot.api) : null,
    app: {
      bot_username: bot.botInfo.username,
      tz_label: config.tzLabel,
      tz_offset_minutes: config.tzOffsetMinutes,
      email_configured: emailConfigured(),
      serverless: config.serverless,
    },
  };
});

/** The bar at the top of the app: who is signed in, and the open votes still waiting for this member. */
route("GET", "/presence", false, async (ctx) => {
  const member = await findByTelegramId(ctx.user.id);
  const [counts, open] = await Promise.all([presenceCounts(), listResolutions("open")]);
  const voted = member ? await memberBallots(member.id) : new Set<string>();
  return {
    ...counts,
    open: open.length,
    waiting: member ? open.filter((r) => !voted.has(r.id)).length : 0,
    presence: member ? (member.presence ?? "available") : null,
  };
});

/** Available, stepped away, busy on a task, or signed out (Logout). */
route("POST", "/me/presence", false, async (ctx) => {
  const member = await findByTelegramId(ctx.user.id);
  if (!member || !member.is_active) throw new HttpError(403, "Please register first.", "not_registered");
  const presence = String((await ctx.body()).presence);
  if (!(PRESENCES as string[]).includes(presence)) throw new HttpError(400, "Unknown presence.");
  if ((member.presence ?? "available") !== presence) {
    await setPresence(member.id, presence as (typeof PRESENCES)[number]);
    await audit(ctx.user.id, presence === "out" ? "signed_out" : isSignedIn(member) ? "presence_set" : "signed_in", { presence, via: "app" });
  }
  return { ok: true, presence };
});

/** A profile photo of the member's own choosing: a small JPEG/PNG/WebP data URL (the app shrinks it), or null for the Telegram photo. */
route("POST", "/me/avatar", false, async (ctx) => {
  const member = await findByTelegramId(ctx.user.id);
  if (!member || !member.is_active) throw new HttpError(403, "Please register first.", "not_registered");
  const data = (await ctx.body()).avatar;
  if (data !== null) {
    if (typeof data !== "string" || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data)) throw new HttpError(400, "The photo must be a JPEG, PNG or WebP image.");
    if (data.length > 200_000) throw new HttpError(400, "The photo is too large.");
  }
  await setAvatar(member.id, data as string | null);
  return { ok: true };
});

/** The person's language for the bot and the app (null = both). */
route("POST", "/me/lang", false, async (ctx) => {
  const lang = (await ctx.body()).lang;
  if (lang !== null && lang !== "en" && lang !== "am") throw new HttpError(400, "lang must be en, am or null.");
  await setLang(ctx.user.id, lang as Lang | null);
  return { ok: true, lang };
});

// ---------------------------------------------------------------------------
// Organisations (Kene Voting System serves several assemblies)
// ---------------------------------------------------------------------------

function parseOrgBody(b: Record<string, unknown>, partial: boolean): Partial<OrgInput> {
  const out: Partial<OrgInput> = {};
  const name = str(b.name_en, "Organisation name", { optional: partial, min: 2, max: 160 });
  if (name) out.name_en = name;
  const code = str(b.short_code, "Short code", { optional: partial, min: 2, max: 8 });
  if (code) out.short_code = code;
  for (const k of ["name_am", "assembly_en", "assembly_am", "office_en", "office_am"] as const) {
    if (b[k] !== undefined) out[k] = str(b[k], k, { optional: true, max: 160 }) || null;
  }
  if (b.voter_term !== undefined) {
    if (!VOTER_TERMS[String(b.voter_term)]) throw new HttpError(400, "Unknown voter term.");
    out.voter_term = String(b.voter_term);
  }
  if (b.group_term !== undefined) {
    if (!GROUP_TERMS[String(b.group_term)]) throw new HttpError(400, "Unknown group term.");
    out.group_term = String(b.group_term);
  }
  if (b.structure !== undefined) {
    if (b.structure !== "councils" && b.structure !== "direct") throw new HttpError(400, "structure must be 'councils' or 'direct'.");
    out.structure = b.structure;
  }
  return out;
}

/** The term presets the setup form offers. */
route("GET", "/orgs/terms", false, async () => ({ voter: VOTER_TERMS, group: GROUP_TERMS, platform: PLATFORM_NAME }));

/** Organisations this person can open (all of them for platform admins). */
route("GET", "/orgs", false, async (ctx) => {
  const mine = await userOrgIds(ctx.user.id);
  const ids = isPlatformAdmin(ctx.user.id) ? (await listOrgs()).map((o) => o.id) : [...new Set([...mine.admin, ...mine.member])];
  return { items: (await Promise.all(ids.map((id) => orgSummary(id, ctx.user.id)))).filter(Boolean), platform_admin: isPlatformAdmin(ctx.user.id) };
});

/** A new organisation (platform admins only). The creator administers it; another first admin may be named. */
route("POST", "/orgs", false, async (ctx) => {
  if (!isPlatformAdmin(ctx.user.id)) throw new HttpError(403, "Only the platform administrators can create organisations.", "forbidden");
  const b = await ctx.body();
  const org = await createOrg(parseOrgBody(b, false) as OrgInput);
  await withOrg(org.id, async () => {
    const firstAdmin = int(b.admin_telegram_id, "First admin's Telegram ID", { optional: true, min: 1 });
    if (firstAdmin !== null) await addDbAdmin(firstAdmin, str(b.admin_name, "Admin name", { optional: true, max: 120 }) || null, ctx.user.id);
    await audit(ctx.user.id, "organization_created", { name: org.name_en, short_code: org.short_code, first_admin: firstAdmin, via: "app" });
  });
  await setActiveOrg(ctx.user.id, org.id);
  return { org: await orgSummary(org.id, ctx.user.id) };
});

/** Edit an organisation's identity and terms (its admins, or platform admins). */
route("PATCH", `/orgs/${UUID}`, false, async (ctx, [id]) => {
  const mine = await userOrgIds(ctx.user.id);
  if (!isPlatformAdmin(ctx.user.id) && !mine.admin.includes(id)) throw new HttpError(403, "Admin access required.", "forbidden");
  if (!(await getOrg(id))) throw new HttpError(404, "Organisation not found.");
  const patch = parseOrgBody(await ctx.body(), true);
  await updateOrg(id, patch);
  await withOrg(id, () => audit(ctx.user.id, "organization_edited", { ...patch, via: "app" }));
  return { org: await orgSummary(id, ctx.user.id) };
});

/** Remember the organisation picked in the app, so the bot chat follows it too. */
route("POST", `/orgs/${UUID}/select`, false, async (ctx, [id]) => {
  const mine = await userOrgIds(ctx.user.id);
  if (!isPlatformAdmin(ctx.user.id) && !mine.admin.includes(id) && !mine.member.includes(id)) throw new HttpError(403, "You are not part of that organisation.", "forbidden");
  await setActiveOrg(ctx.user.id, id);
  return { ok: true };
});

/**
 * Invitation this Telegram account scanned in the bot chat (/start inv_<code>)
 * but has not completed yet: the app fills the code in and asks for the
 * password only.
 */
route("GET", "/register/pending", false, async (ctx) => {
  if (await findByTelegramId(ctx.user.id)) return { token_id: null, registered: true };
  const tokenId = await pendingInvitation(ctx.user.id);
  if (!tokenId) return { token_id: null };
  const member = await findByToken(tokenId);
  if (!member || member.telegram_user_id !== null || !member.is_active) {
    await clearInvitation(ctx.user.id); // used by someone else or revoked meanwhile
    return { token_id: null };
  }
  return { token_id: member.token_id, full_name: member.full_name, region: member.region };
});

route("POST", "/register", false, async (ctx) => {
  const b = await ctx.body();
  // The token may be left out when the bot already recognised an invitation for this account.
  const token = str(b.token, "Token", { optional: true, max: 40 }) || (await pendingInvitation(ctx.user.id)) || "";
  if (token.length < 3) throw new HttpError(400, "Token is required");
  const password = str(b.password, "Password", { min: 1, max: 100 });
  // Already registered in the organisation this code belongs to? (Not the one the app happens to be on:
  // the same person may join a second organisation with that organisation's code.)
  const invited = await findByToken(token);
  if (invited) {
    const existing = await withOrg(invited.org_id, () => findByTelegramId(ctx.user.id));
    if (existing) return { status: "ok", member: safeMember(existing), already: true, org_id: invited.org_id };
  }
  const result = await loginWithCredentials(token, password, ctx.user.id);
  if (result.status === "ok") {
    const member = result.member;
    // The code decided the organisation; carry on (and stay) in it.
    return withOrg(member.org_id, async () => {
      await clearInvitation(ctx.user.id);
      await setActiveOrg(ctx.user.id, member.org_id);
      void approvePendingJoin(bot.api, ctx.user.id); // waiting at the group door? let them in
      const groupLink = await groupInviteLink(bot.api);
      // Same confirmation in the chat as the chat registration gives, with the way into the group.
      try {
        await bot.api.sendMessage(
          ctx.user.id,
          `🎉 Registration complete, <b>${escapeHtml(member.full_name ?? member.token_id)}</b>!\n\n` +
            `Announcements and discussion happen in the assembly group — open it below. Ballots and results reach you here.`,
          { parse_mode: "HTML", reply_markup: await afterRegistrationKeyboard(bot.api) },
        );
      } catch {
        // The member may not have opened the bot chat yet.
      }
      return { status: "ok", member: safeMember(member), group_link: groupLink, org_id: member.org_id };
    });
  }
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
      const e = await enrich(res, ctx.isAdmin, ctx.isAdmin);
      open.push({
        ...e,
        voted: voted.has(res.id),
        my_choice: res.anonymous ? null : (choices.get(res.id) ?? null),
        needs_activation: member ? await needsActivation(res, member.id) : Boolean(res.activation_required && res.activation_code),
      });
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
  if (!isSignedIn(member)) throw new HttpError(403, "You signed out of the session. Sign in to vote.", "signed_out");
  if (res.status === "open" && (await needsActivation(res, member.id))) {
    throw new HttpError(403, "Enter the activation code shown in the meeting first.", "activation_required");
  }
  const outcome = await castVote(res.id, member.id, choice);
  if (outcome === "ok") await audit(ctx.user.id, "vote_cast", { resolution: res.code, anonymous: res.anonymous, via: "app" });
  if (outcome === "changed") await audit(ctx.user.id, "vote_changed", { resolution: res.code, via: "app" });
  return { result: outcome, option: res.options[choice], anonymous: res.anonymous };
});

/** A member enters the 4-digit code shown in the meeting; voting on that resolution then unlocks for them. */
route("POST", `/resolutions/${UUID}/activate`, false, async (ctx, [id]) => {
  const member = await findByTelegramId(ctx.user.id);
  if (!member || !member.is_active) throw new HttpError(403, "Please register first.", "not_registered");
  const res = await requireResolution(id);
  const code = str((await ctx.body()).code, "Code", { min: 1, max: 10 });
  const result = await activate(res, member.id, code);
  if (result.status === "ok") await audit(ctx.user.id, "vote_activated", { resolution: res.code, via: "app" });
  if (result.status === "locked") await audit(ctx.user.id, "vote_activation_locked", { resolution: res.code, via: "app" });
  return result;
});

route("GET", `/results/${UUID}`, false, async (ctx, [id]) => {
  const res = await requireResolution(id);
  if (res.status !== "closed" && !ctx.isAdmin) throw new HttpError(403, "Results are published when voting closes.");
  return enrich(res, true, ctx.isAdmin);
});

// ---------------------------------------------------------------------------
// Admin: dashboard & resolutions
// ---------------------------------------------------------------------------

route("GET", "/dashboard", true, async () => {
  const [counts, all, group] = await Promise.all([memberCounts(), listResolutions(), getLinkedGroup()]);
  const resolutions = await Promise.all(all.map((r) => enrich(r, r.status !== "draft", true)));
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
  return { items: await Promise.all(all.map((r) => enrich(r, r.status !== "draft", true))) };
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
  if (!input.activation_required) patch.activation_required = false;
  if (Object.keys(patch).length) await updateResolution(res.id, patch);
  await audit(ctx.user.id, "resolution_created", { code: res.code, title: res.title, via: "app" });
  return enrich((await getById(res.id))!, false, true);
});

route("GET", `/resolutions/${UUID}`, true, async (_ctx, [id]) => {
  const res = await requireResolution(id);
  const [e, topics] = await Promise.all([enrich(res, res.status !== "draft", true), listTopics()]);
  return { ...e, topics };
});

/** A new activation code for an open resolution (e.g. the old one was shared outside the meeting). Members who already activated stay activated. */
route("POST", `/resolutions/${UUID}/activation-code`, true, async (ctx, [id]) => {
  const res = await requireResolution(id);
  if (res.status !== "open") throw new HttpError(409, "Voting is not open.");
  if (!res.activation_required) throw new HttpError(409, "This resolution does not use an activation code.");
  await regenerateActivationCode(res.id);
  await audit(ctx.user.id, "activation_code_changed", { resolution: res.code, via: "app" });
  return enrich((await getById(res.id))!, true, true);
});

route("PATCH", `/resolutions/${UUID}`, true, async (ctx, [id]) => {
  const res = await requireResolution(id);
  if (res.status !== "draft") throw new HttpError(409, "Only drafts can be edited.");
  const input = parseResolutionBody(await ctx.body());
  const ok = await updateResolution(res.id, input);
  if (!ok) throw new HttpError(409, "The resolution is no longer a draft.");
  await audit(ctx.user.id, "resolution_edited", { code: res.code, via: "app" });
  return enrich((await getById(res.id))!, false, true);
});

route("DELETE", `/resolutions/${UUID}`, true, async (ctx, [id]) => {
  const res = await requireResolution(id);
  if (res.status !== "draft") throw new HttpError(409, "Only drafts can be deleted.");
  const ok = await deleteResolution(res.id);
  if (!ok) throw new HttpError(409, "The resolution is no longer a draft.");
  if (res.motion_id) await afterMotionVoteCancelled(bot.api, res.motion_id);
  await audit(ctx.user.id, "resolution_deleted", { code: res.code, via: "app" });
  return { ok: true };
});

route("POST", `/resolutions/${UUID}/open`, true, async (ctx, [id]) => {
  const res = await requireResolution(id);
  if (res.status === "closed") throw new HttpError(409, "Voting is closed. Use “Reopen voting” to open it again.");
  if (res.status === "open") throw new HttpError(409, "Voting is already open.");
  const closesAt = parseDeadlineBody(await ctx.body());
  await setStatus(res.id, "open", closesAt);
  await audit(ctx.user.id, "resolution_opened", { code: res.code, closes_at: closesAt?.toISOString() ?? null, via: "app" });
  return enrich((await getById(res.id))!, true, true);
});

/** Deadline from an open/reopen body: `minutes` from now, an ISO `closes_at`, or none. */
function parseDeadlineBody(b: Record<string, unknown>): Date | null {
  const minutes = int(b.minutes, "minutes", { optional: true, min: 1, max: 60 * 24 * 30 });
  if (minutes !== null) return new Date(Date.now() + minutes * 60_000);
  if (b.closes_at) {
    const d = new Date(String(b.closes_at));
    if (Number.isNaN(d.getTime())) throw new HttpError(400, "Invalid deadline.");
    if (d.getTime() <= Date.now() + 30_000) throw new HttpError(400, "The deadline must be in the future.");
    return d;
  }
  return null;
}

/**
 * Reopen a closed resolution (closed too early or by mistake). Ballots already
 * cast stay; members who have not voted can vote until it closes again, when
 * the results are published once more.
 */
route("POST", `/resolutions/${UUID}/reopen`, true, async (ctx, [id]) => {
  const res = await requireResolution(id);
  if (res.status !== "closed") throw new HttpError(409, "Only a closed resolution can be reopened.");
  const closesAt = parseDeadlineBody(await ctx.body());
  if (!(await reopenResolution(res.id, closesAt))) throw new HttpError(409, "The resolution is no longer closed.");
  if (res.motion_id) await afterMotionVoteReopened(bot.api, res.id);
  await audit(ctx.user.id, "resolution_reopened", { code: res.code, closes_at: closesAt?.toISOString() ?? null, via: "app" });
  let notified = false;
  if (res.announce_chat_id) {
    // Tell the room where it was announced, with the vote button, so members know they can still vote.
    try {
      await bot.api.sendMessage(
        res.announce_chat_id,
        `🔁 Voting on <b>${escapeHtml(res.code)} — ${escapeHtml(res.title)}</b> has been <b>reopened</b>.` +
          (closesAt ? `\n⏰ It closes again at <b>${formatLocal(closesAt)}</b>.` : "") +
          "\nBallots already cast are kept.",
        { parse_mode: "HTML", message_thread_id: res.announce_thread_id ?? undefined, reply_markup: announceKeyboard(res, bot.botInfo.username) },
      );
      notified = true;
    } catch (err) {
      console.error(`failed to post the ${res.code} reopening to its announce chat:`, err);
    }
  }
  return { ...(await enrich((await getById(res.id))!, true, true)), notified };
});

/** Close now; with `redo: true` also create a fresh draft copy (used when quorum was not reached). */
route("POST", `/resolutions/${UUID}/close`, true, async (ctx, [id]) => {
  const res = await requireResolution(id);
  if (res.status !== "open") throw new HttpError(409, "Voting is not open.");
  const b = await ctx.body().catch(() => ({}) as Record<string, unknown>);
  const { text, draft } = await closeWaiting(bot.api, res, ctx.user.id, b.redo === true);
  if (!text) throw new HttpError(409, "The resolution was already closed.");
  return {
    ...(await enrich((await getById(res.id))!, true, true)),
    published: Boolean(res.announce_chat_id),
    redo_draft: draft ? { id: draft.id, code: draft.code } : null,
  };
});

/** Extend voting by `minutes` from now (any open vote; typically one waiting for quorum after its deadline). */
route("POST", `/resolutions/${UUID}/extend`, true, async (ctx, [id]) => {
  const res = await requireResolution(id);
  if (res.status !== "open") throw new HttpError(409, "Voting is not open.");
  const minutes = int((await ctx.body()).minutes, "Minutes", { min: 1, max: 24 * 60 })!;
  await extendVote(res, minutes, ctx.user.id);
  return enrich((await getById(res.id))!, true, true);
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
    await bot.api.sendMessage(target.chat_id, resultsText(res, rows, ballots, await eligibleFor(res)), {
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
// Motions: moved by members, seconded, stated by the chair, amended, put to the vote
// ---------------------------------------------------------------------------

/** The member behind a request, when they may take part (registered, active, signed in). */
async function participant(ctx: Ctx): Promise<Member> {
  const member = await findByTelegramId(ctx.user.id);
  if (!member || !member.is_active) throw new HttpError(403, "Only registered members can do this.", "not_registered");
  if (!isSignedIn(member)) throw new HttpError(403, "You are signed out of the session. Sign in first.", "signed_out");
  return member;
}

async function requireMotion(id: string): Promise<Motion> {
  const m = await getMotion(id);
  if (!m) throw new HttpError(404, "Motion not found.");
  return m;
}

/** Topics of the linked group a motion may be moved in: General and every topic members post in. */
async function motionTopics(): Promise<{ thread_id: number; name: string }[]> {
  const group = await getLinkedGroup();
  if (!group) return [];
  return (await listTopics())
    .filter((t) => Number(t.chat_id) === group.chat_id && !t.read_only)
    .map((t) => ({ thread_id: Number(t.thread_id), name: t.name ?? (Number(t.thread_id) === 0 ? "General" : `Topic #${t.thread_id}`) }));
}

async function motionThread(v: unknown): Promise<{ chat_id: number | null; thread_id: number | null }> {
  const group = await getLinkedGroup();
  if (!group) return { chat_id: null, thread_id: null };
  const wanted = int(v, "thread_id", { optional: true, min: 0 });
  if (!wanted) return { chat_id: group.chat_id, thread_id: null };
  const ok = (await motionTopics()).some((t) => t.thread_id === wanted);
  return { chat_id: group.chat_id, thread_id: ok ? wanted : null };
}

function parseKind(v: unknown): MotionKind {
  return v === "constitutional" ? "constitutional" : "main";
}

async function presentMotions(list: Motion[], viewer: Member | null, admin: boolean) {
  const [all, resolutions, topics] = await Promise.all([listMotions(), listResolutions(), listTopics()]);
  const byId = new Map(all.map((m) => [m.id, m]));
  const resById = new Map(resolutions.map((r) => [r.id, r]));
  return list.map((m) => {
    const res = m.resolution_id ? resById.get(m.resolution_id) : undefined;
    const topic = topics.find((t) => Number(t.chat_id) === Number(m.chat_id) && Number(t.thread_id) === Number(m.thread_id ?? 0));
    const amendments = all.filter((a) => a.parent_id === m.id);
    const mine = Boolean(viewer && m.mover_member_id === viewer.id);
    return {
      ...m,
      parent_code: m.parent_id ? (byId.get(m.parent_id)?.code ?? null) : null,
      merged_into_code: m.merged_into ? (byId.get(m.merged_into)?.code ?? null) : null,
      resolution_code: res?.code ?? null,
      resolution_status: res?.status ?? null,
      topic_name: topic ? (topic.name ?? (Number(topic.thread_id) === 0 ? "General" : `Topic #${topic.thread_id}`)) : null,
      amendments_total: amendments.length,
      amendments_pending: amendments.filter((a) => PENDING.includes(a.status)).length,
      created_at_local: formatLocal(m.created_at),
      decided_at_local: m.decided_at ? formatLocal(m.decided_at) : null,
      mine,
      can_second: Boolean(viewer && m.status === "proposed" && !mine && isSignedIn(viewer)),
      can_withdraw: (m.status === "proposed" || m.status === "seconded") && (mine || (admin && m.from_floor)),
      can_amend: Boolean(viewer && m.status === "stated" && m.kind !== "amendment" && isSignedIn(viewer)),
    };
  });
}

async function motionViewer(ctx: Ctx): Promise<Member | null> {
  const member = await findByTelegramId(ctx.user.id);
  if (!ctx.isAdmin && (!member || !member.is_active)) throw new HttpError(403, "Only registered members can see the motions.", "not_registered");
  return member && member.is_active ? member : null;
}

async function postCard(m: Motion): Promise<boolean> {
  try {
    return await postMotionCard(bot.api, m);
  } catch (err) {
    console.error(`motion ${m.code}: posting its card failed:`, (err as Error).message);
    return false;
  }
}

route("GET", "/motions", false, async (ctx) => {
  const viewer = await motionViewer(ctx);
  const [items, rules, topics] = await Promise.all([listMotions(), getMotionRules(), motionTopics()]);
  return {
    items: await presentMotions(items.reverse(), viewer, ctx.isAdmin),
    rules,
    topics,
    can_move: Boolean(viewer && isSignedIn(viewer)),
  };
});

route("GET", `/motions/${UUID}`, false, async (ctx, [id]) => {
  const viewer = await motionViewer(ctx);
  const m = await requireMotion(id);
  const [e] = await presentMotions([m], viewer, ctx.isAdmin);
  const parent = m.parent_id ? await getMotion(m.parent_id) : null;
  return {
    ...e,
    parent: parent ? (await presentMotions([parent], viewer, ctx.isAdmin))[0] : null,
    amendments: await presentMotions(await amendmentsOf(m.id), viewer, ctx.isAdmin),
    merge_targets: ctx.isAdmin
      ? (await listMotions()).filter((x) => x.id !== m.id && !x.parent_id && (x.status === "seconded" || x.status === "stated")).map((x) => ({ id: x.id, code: x.code, title: x.title }))
      : [],
  };
});

/** A member moves a motion; its card goes to the topic it was moved from. */
route("POST", "/motions", false, async (ctx) => {
  const member = await participant(ctx);
  const b = await ctx.body();
  const m = await createMotion({
    kind: parseKind(b.kind),
    title: str(b.title, "Title", { min: 3, max: 200 }),
    body: str(b.body, "Wording", { min: 5, max: 3000 }),
    mover: { member_id: member.id, name: memberName(member) },
    ...(await motionThread(b.thread_id)),
  });
  await audit(ctx.user.id, "motion_moved", { code: m.code, kind: m.kind, via: "app" });
  const posted = await postCard(m);
  return { ...(await presentMotions([(await getMotion(m.id))!], member, ctx.isAdmin))[0], posted };
});

/** A member moves an amendment to a motion under debate. */
route("POST", `/motions/${UUID}/amendments`, false, async (ctx, [id]) => {
  const member = await participant(ctx);
  const parent = await requireMotion(id);
  if (parent.kind === "amendment") throw new HttpError(409, "An amendment cannot be amended here; propose a new amendment to the motion instead.");
  if (parent.status !== "stated") throw new HttpError(409, "Amendments can be moved only while the chair has the motion under debate.");
  const b = await ctx.body();
  const m = await createMotion({
    kind: "amendment",
    parent,
    title: str(b.title, "Title", { optional: true, max: 200 }) || `Amendment to ${parent.code}`,
    body: str(b.body, "Wording", { min: 5, max: 3000 }),
    mover: { member_id: member.id, name: memberName(member) },
  });
  await audit(ctx.user.id, "amendment_moved", { code: m.code, parent: parent.code, via: "app" });
  const posted = await postCard(m);
  return { ...(await presentMotions([(await getMotion(m.id))!], member, ctx.isAdmin))[0], posted };
});

route("POST", `/motions/${UUID}/second`, false, async (ctx, [id]) => {
  const member = await participant(ctx);
  const r = await secondMotion(id, member);
  if ("refused" in r) {
    const msg = {
      not_found: "Motion not found.",
      not_proposed: "This motion is no longer waiting for a seconder.",
      own_motion: "You moved this motion; another member must second it.",
      same_council: "The seconder must come from another council than the mover.",
    }[r.refused];
    throw new HttpError(r.refused === "not_found" ? 404 : 409, msg, r.refused);
  }
  await audit(ctx.user.id, "motion_seconded", { code: r.motion.code, via: "app" });
  await refreshMotionCard(bot.api, r.motion);
  await tellAdminsSeconded(bot.api, r.motion);
  return (await presentMotions([r.motion], member, ctx.isAdmin))[0];
});

route("POST", `/motions/${UUID}/withdraw`, false, async (ctx, [id]) => {
  const m = await requireMotion(id);
  const member = await findByTelegramId(ctx.user.id);
  const mine = Boolean(member && m.mover_member_id === member.id);
  if (!mine && !(ctx.isAdmin && m.from_floor)) throw new HttpError(403, "Only the mover can withdraw a motion.");
  const reason = str((await ctx.body()).reason, "Reason", { optional: true, max: 500 }) || null;
  const row = await withdrawMotion(m, reason);
  if (!row) throw new HttpError(409, "A motion can be withdrawn only until the chair states it.");
  await audit(ctx.user.id, "motion_withdrawn", { code: m.code, via: "app" });
  await refreshMotionCard(bot.api, row);
  return (await presentMotions([row], member, ctx.isAdmin))[0];
});

// ---- the chair (admins)

route("POST", "/motions/rules", true, async (ctx) => {
  const b = await ctx.body();
  let deadline: string | null = null;
  if (b.notice_deadline) {
    const d = new Date(String(b.notice_deadline));
    if (Number.isNaN(d.getTime())) throw new HttpError(400, "Invalid notice deadline.");
    deadline = d.toISOString();
  }
  const rules = { notice_deadline: deadline, second_other_council: b.second_other_council === true };
  await setMotionRules(rules);
  await audit(ctx.user.id, "motion_rules_set", { ...rules, via: "app" });
  return rules;
});

/** A motion made aloud in the meeting, entered by the chair with its mover (and seconder, if any). */
route("POST", "/motions/floor", true, async (ctx) => {
  const b = await ctx.body();
  const parent = b.parent_id ? await requireMotion(String(b.parent_id)) : null;
  if (parent && (parent.status !== "stated" || parent.kind === "amendment")) throw new HttpError(409, "Amendments can be moved only to a motion under debate.");
  const seconder = str(b.seconder_name, "Seconder", { optional: true, max: 120 });
  const title = str(b.title, "Title", { optional: true, max: 200 });
  if (!parent && title.length < 3) throw new HttpError(400, "Title is required");
  const m = await createMotion({
    kind: parent ? "amendment" : parseKind(b.kind),
    parent,
    title: title || `Amendment to ${parent!.code}`,
    body: str(b.body, "Wording", { min: 5, max: 3000 }),
    mover: { member_id: null, name: str(b.mover_name, "Mover", { min: 2, max: 120 }) },
    seconder: seconder ? { member_id: null, name: seconder } : null,
    from_floor: true,
    ...(parent ? {} : await motionThread(b.thread_id)),
  });
  await audit(ctx.user.id, "motion_entered_from_floor", { code: m.code, via: "app" });
  const posted = await postCard(m);
  return { ...(await presentMotions([(await getMotion(m.id))!], null, true))[0], posted };
});

route("PATCH", `/motions/${UUID}`, true, async (ctx, [id]) => {
  const m = await requireMotion(id);
  const b = await ctx.body();
  const row = await rewordMotion(m, str(b.title, "Title", { min: 3, max: 200 }), str(b.body, "Wording", { min: 5, max: 3000 }));
  if (!row) throw new HttpError(409, "The wording can be changed only before the vote.");
  await audit(ctx.user.id, "motion_reworded", { code: m.code, via: "app" });
  await refreshMotionCard(bot.api, row);
  return (await presentMotions([row], null, true))[0];
});

/** The chair states the motion: before the assembly, open for debate and amendments. */
route("POST", `/motions/${UUID}/state`, true, async (ctx, [id]) => {
  const m = await requireMotion(id);
  const b = await ctx.body().catch(() => ({}) as Record<string, unknown>);
  if (m.status !== "seconded") throw new HttpError(409, m.status === "proposed" ? "The motion needs a seconder first." : "The motion is not waiting for the chair.");
  if (m.kind === "amendment") {
    const parent = m.parent_id ? await getMotion(m.parent_id) : null;
    if (!parent || parent.status !== "stated") throw new HttpError(409, "The motion this amendment changes is no longer under debate.");
  }
  if (m.late_notice && b.override !== true) {
    throw new HttpError(409, "This constitutional motion was moved after the notice deadline. Accept it anyway only if the assembly agreed to waive the notice.", "late_notice");
  }
  const row = await stateMotion(m);
  if (!row) throw new HttpError(409, "The motion is not waiting for the chair.");
  await audit(ctx.user.id, "motion_stated", { code: m.code, late_notice_waived: m.late_notice, via: "app" });
  await refreshMotionCard(bot.api, row);
  await noteInTopic(
    bot.api,
    row,
    m.kind === "amendment"
      ? `🧑‍⚖️ The chair has stated amendment <b>${escapeHtml(m.code)}</b>. Debate it here; it is voted on before the motion it changes.\n🧑‍⚖️ ሰብሳቢው ማሻሻያ ${escapeHtml(m.code)}ን አቅርበዋል።`
      : `🧑‍⚖️ The chair has stated <b>${escapeHtml(m.code)} — ${escapeHtml(m.title)}</b>. Debate is open; propose amendments with the button on the motion.\n🧑‍⚖️ ሰብሳቢው ${escapeHtml(m.code)}ን አቅርበዋል። ውይይቱ ተከፍቷል፤ ማሻሻያ በሀሳቡ ላይ ባለው አዝራር ያቅርቡ።`,
  );
  return (await presentMotions([row], null, true))[0];
});

async function closeByChair(ctx: Ctx, m: Motion, status: "out_of_order" | "merged" | "lapsed", reason: string | null, into: Motion | null = null) {
  const row = await closeMotion(m, status, reason, into?.id ?? null);
  if (!row) {
    throw new HttpError(409, status === "lapsed" ? "Only a motion still waiting for a seconder can lapse." : "Only a motion not yet put to the vote can be closed this way.");
  }
  await audit(ctx.user.id, `motion_${status}`, { code: m.code, reason, into: into?.code ?? null, via: "app" });
  await refreshMotionCard(bot.api, row);
  for (const a of await amendmentsOf(m.id)) await refreshMotionCard(bot.api, a);
  return (await presentMotions([row], null, true))[0];
}

route("POST", `/motions/${UUID}/out-of-order`, true, async (ctx, [id]) => {
  const m = await requireMotion(id);
  return closeByChair(ctx, m, "out_of_order", str((await ctx.body()).reason, "Reason", { min: 3, max: 500 }));
});

route("POST", `/motions/${UUID}/merge`, true, async (ctx, [id]) => {
  const m = await requireMotion(id);
  const b = await ctx.body();
  const into = await requireMotion(String(b.into ?? ""));
  if (into.id === m.id || into.parent_id || !(into.status === "seconded" || into.status === "stated")) throw new HttpError(400, "Merge into another motion in the queue or under debate.");
  return closeByChair(ctx, m, "merged", str(b.reason, "Reason", { optional: true, max: 500 }) || `Same subject as ${into.code}.`, into);
});

route("POST", `/motions/${UUID}/lapse`, true, async (ctx, [id]) => {
  return closeByChair(ctx, await requireMotion(id), "lapsed", null);
});

/** Put a stated motion to the vote: a draft resolution (For / Against / Abstain) the chair then opens. */
route("POST", `/motions/${UUID}/vote`, true, async (ctx, [id]) => {
  const m = await requireMotion(id);
  if (m.status !== "stated") throw new HttpError(409, "Only a motion the chair has stated can be put to the vote.");
  let res: Resolution | null;
  try {
    res = await putToVote(m);
  } catch (err) {
    if (err instanceof PendingAmendmentsError) throw new HttpError(409, err.message, "pending_amendments");
    throw err;
  }
  if (!res) throw new HttpError(409, "Only a motion the chair has stated can be put to the vote.");
  await audit(ctx.user.id, "motion_put_to_vote", { code: m.code, resolution: res.code, via: "app" });
  const row = (await getMotion(m.id))!;
  await refreshMotionCard(bot.api, row);
  return { ...(await presentMotions([row], null, true))[0], resolution_id: res.id };
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

/**
 * Members who vote for themselves (organisations without councils, e.g. a
 * share company): one invitation per person — a name, a phone number or both —
 * each with its own number of votes (shares; default 1). Max 40 per request.
 */
route("POST", "/members/invitations", true, async (ctx) => {
  const b = await ctx.body();
  if (!Array.isArray(b.people)) throw new HttpError(400, "people must be a list");
  if (b.people.length === 0) throw new HttpError(400, "Nobody to invite.");
  if (b.people.length > INVITE_BATCH) throw new HttpError(400, `At most ${INVITE_BATCH} per request; the app sends larger lists in batches.`);
  const people: Person[] = b.people.map((p, i) => {
    const o = asObject(p);
    const rawPhone = str(o.phone, `Phone ${i + 1}`, { optional: true, max: 30 });
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    if (rawPhone && !phone) throw new HttpError(400, `Line ${i + 1}: “${rawPhone}” is not a phone number.`);
    const votes = int(o.votes ?? o.vote_weight, `Line ${i + 1}: votes`, { optional: true, min: 1, max: 1_000_000 });
    return { name: str(o.name, `Name ${i + 1}`, { optional: true, max: 120 }) || null, region: null, phone, vote_weight: votes ?? 1 };
  });
  const rows = await generateCredentials(people, await defaultCodePrefix());
  await audit(ctx.user.id, "invitations_issued", { council: null, count: rows.length, via: "app" });
  return { rows };
});

/** How many votes this member casts (shares, or a council-given weight); applies to ballots cast from now on. */
route("POST", `/members/${UUID}/votes`, true, async (ctx, [id]) => {
  const m = await findById(id);
  if (!m) throw new HttpError(404, "Member not found.");
  const votes = int((await ctx.body()).votes, "Votes", { min: 1, max: 1_000_000 })!;
  const { error } = await supabase.from("members").update({ vote_weight: votes }).eq("id", id);
  if (error) throw error;
  await audit(ctx.user.id, "member_votes_set", { token: m.token_id, from: m.vote_weight ?? 1, to: votes, via: "app" });
  return { ok: true, vote_weight: votes };
});

route("POST", `/members/${UUID}/active`, true, async (ctx, [id]) => {
  const m = await findById(id);
  if (!m) throw new HttpError(404, "Member not found.");
  const active = bool((await ctx.body()).active, "active", !m.is_active);
  if (active && !m.is_active && m.council_id) {
    // Reactivating takes a seat back: only while the council has one free.
    const c = await getCouncil(m.council_id);
    const occupied = occupiedSeats(await councilMembers(m.council_id));
    if (c && occupied >= c.seats) throw new HttpError(409, new SeatsFullError(c, occupied, 1).message, "seats_full");
  }
  await setMemberActive(id, active);
  await audit(ctx.user.id, active ? "member_activated" : "member_deactivated", { token: m.token_id, via: "app" });
  return { ok: true, is_active: active };
});

/**
 * Revoke an invitation that has not been used: the code and password stop
 * working for good and the seat is freed. A registered member is never
 * deleted (their ballots must stay counted) — use /revoke for them.
 */
route("DELETE", `/members/${UUID}`, true, async (ctx, [id]) => {
  const m = await findById(id);
  if (!m) throw new HttpError(404, "Invitation not found.");
  if (m.telegram_user_id !== null) throw new HttpError(409, "This invitation is already registered — revoke the member's access instead.", "registered");
  const { count, error: bErr } = await supabase.from("ballots").select("*", { count: "exact", head: true }).eq("member_id", id);
  if (bErr) throw bErr;
  if ((count ?? 0) > 0) throw new HttpError(409, "This invitation has ballots on record — deactivate it instead.", "has_ballots");
  const { error } = await supabase.from("members").delete().eq("id", id);
  if (error) throw error;
  await audit(ctx.user.id, "invitation_revoked", { token: m.token_id, council_id: m.council_id, seat_no: m.seat_no, via: "app" });
  return { ok: true };
});

/**
 * Revoke a registered member's access: deactivated (cannot vote or register
 * again with that code), Telegram account detached, removed from the
 * assembly group, and told so. Ballots already cast stay counted.
 */
route("POST", `/members/${UUID}/revoke`, true, async (ctx, [id]) => {
  const m = await findById(id);
  if (!m) throw new HttpError(404, "Member not found.");
  const telegramId = m.telegram_user_id;
  await setMemberActive(id, false);
  if (telegramId !== null) await unbindById(id);
  let removedFromGroup = false;
  const group = await getLinkedGroup();
  if (telegramId !== null && group) {
    try {
      await kickFromGroup(bot.api, group.chat_id, telegramId);
      removedFromGroup = true;
    } catch {
      // Not in the group, or the bot lacks the "Ban users" right.
    }
  }
  if (telegramId !== null) {
    try {
      const w = await orgWords();
      await bot.api.sendMessage(telegramId, `Your voting access for the ${w.assembly} of ${w.name} has been revoked by the administrators. Contact the ${w.office} if you think this is a mistake.`);
    } catch {
      // The member blocked the bot or never opened it.
    }
  }
  await audit(ctx.user.id, "member_access_revoked", { token: m.token_id, user_id: telegramId, removed_from_group: removedFromGroup, via: "app" });
  return { ok: true, removed_from_group: removedFromGroup };
});

/**
 * Generate credentials. Capped per request (bcrypt is deliberately slow);
 * the client loops over larger lists and then asks for a single CSV file.
 */
route("POST", "/members/generate", true, async (ctx) => {
  const b = await ctx.body();
  const prefix = str(b.prefix, "Prefix", { optional: true, max: 20 }) || (await defaultCodePrefix());
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
      phone: str(o.phone, "phone", { optional: true, max: 30 }) || null,
    };
  });
  const stamp = formatLocal(new Date()).replace(/[: ]/g, "-");
  try {
    await bot.api.sendDocument(ctx.user.id, new InputFile(Buffer.from(credentialsCsv(rows), "utf8"), `${(await orgWords()).shortCode.toLowerCase()}-credentials-${stamp}.csv`), {
      caption:
        `🔐 ${rows.length} credential(s). This is the ONLY copy of the passwords. ` +
        "Distribute one row per member through a secure channel, then delete this file from the chat.",
    });
  } catch (err) {
    throw new HttpError(502, `Could not send the file to your chat: ${(err as Error).message}. Send /start to the bot first.`);
  }
  return { ok: true, count: rows.length };
});

/** Send a fill-in Excel template for an upload (councils + delegates, a council's delegates, or members) to the admin's chat. */
route("POST", "/templates", true, async (ctx) => {
  const kind = str((await ctx.body()).kind, "kind") as TemplateKind;
  if (!TEMPLATE_KINDS.includes(kind)) throw new HttpError(400, "Unknown template.");
  const file = templateFile(kind, await orgWords());
  try {
    await bot.api.sendDocument(ctx.user.id, new InputFile(file.data, file.name), {
      caption: "📥 Fill in the first sheet (keep its header row), then upload the file in the app. The second sheet explains each column.",
    });
  } catch (err) {
    throw new HttpError(502, `Could not send the file to your chat: ${(err as Error).message}. Send /start to the bot first.`);
  }
  return { ok: true, file: file.name };
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
      vote_weight: int(o.vote_weight, "vote_weight", { optional: true, min: 1, max: 1_000_000 }) ?? 1,
      phone: str(o.phone, "phone", { optional: true, max: 30 }) || null,
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
  if (seats !== null) {
    const occupied = occupiedSeats(await councilMembers(id));
    if (seats < occupied) {
      throw new HttpError(409, `${occupied} invitation(s) of this council are already issued, so it needs at least ${occupied} voting seats. Revoke unused invitations first to lower it.`, "seats_below_issued");
    }
    patch.seats = seats;
  }
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

/**
 * Issue invitations: `people` ([{name, phone}] — either or both; empty = anonymous seat),
 * `names` (one per delegate), or a `count`. Max 40 per request.
 */
route("POST", `/councils/${UUID}/invitations`, true, async (ctx, [id]) => {
  const c = await requireCouncil(id);
  const b = await ctx.body();
  let entries: DelegateEntry[];
  if (Array.isArray(b.people)) {
    entries = b.people.map((p, i) => {
      const o = asObject(p);
      const rawPhone = str(o.phone, `Phone ${i + 1}`, { optional: true, max: 30 });
      const phone = rawPhone ? normalizePhone(rawPhone) : null;
      if (rawPhone && !phone) throw new HttpError(400, `Line ${i + 1}: “${rawPhone}” is not a phone number.`);
      return { name: str(o.name, `Name ${i + 1}`, { optional: true, max: 120 }) || null, phone };
    });
  } else if (Array.isArray(b.names)) {
    entries = b.names.map((n, i) => ({ name: str(n, `Name ${i + 1}`, { optional: true, max: 120 }) || null }));
  } else {
    const count = int(b.count, "Count", { min: 1, max: INVITE_BATCH })!;
    entries = Array.from({ length: count }, () => ({ name: null }));
  }
  if (entries.length === 0) throw new HttpError(400, "Nobody to invite.");
  if (entries.length > INVITE_BATCH) throw new HttpError(400, `At most ${INVITE_BATCH} per request; the app sends larger lists in batches.`);
  let rows: CredentialRow[];
  try {
    rows = await issueInvitations(c, entries);
  } catch (err) {
    if (err instanceof SeatsFullError) throw new HttpError(409, err.message, "seats_full");
    throw err;
  }
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

/** File-name-safe slug of a delegate's name (letters of any script are kept). */
function fileSlug(s: string | null): string {
  return (s ?? "").normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

/**
 * Build the printable PDF (QR + link per invitation) and send it to the admin
 * chat — one file for the council, or with `separate: true` one file per
 * delegate (sent as albums of up to 10 documents) so each can be forwarded to
 * its delegate on its own.
 */
route("POST", `/councils/${UUID}/invitations-pdf`, true, async (ctx, [id]) => {
  const c = await requireCouncil(id);
  const body = await ctx.body();
  return sendInvitationPdfs(ctx.user.id, c, invitationRows(body), body.separate === true);
});

/** Invitation PDFs for members of an organisation without councils (they vote for themselves). */
route("POST", "/members/invitations-pdf", true, async (ctx) => {
  const body = await ctx.body();
  return sendInvitationPdfs(ctx.user.id, null, invitationRows(body), body.separate === true);
});

/**
 * Build the printable invitations and send them to the admin's chat: one PDF,
 * or with `separate` one PDF per person (albums of up to 10 documents) so each
 * can be forwarded on its own. `council` is null for organisations whose
 * members vote directly.
 */
async function sendInvitationPdfs(userId: number, c: Council | null, rows: InvitationRow[], separate: boolean) {
  const w = await orgWords();
  const prefix = w.shortCode.toLowerCase();
  const body = c ? c.name : w.name;
  const who = c ? w.voter.en : "member";
  const stamp = formatLocal(new Date()).replace(/[: ]/g, "-");
  const pdfOf = (list: InvitationRow[]) => invitationsPdf({ council: c, rows: list, botUsername: bot.botInfo.username, words: w });
  if (separate) {
    const docs = [];
    for (const [i, row] of rows.entries()) {
      const pdf = await pdfOf([row]);
      const seat = String(row.seat_no ?? i + 1).padStart(2, "0");
      const name = fileSlug(row.full_name || row.phone || null);
      docs.push({ pdf, file: `${prefix}-invitation-${c ? `${c.code.toLowerCase()}-${seat}` : row.token_id.toLowerCase()}${name ? `-${name}` : ""}.pdf` });
    }
    const caption =
      `🎫 ${rows.length} invitation(s) for ${body}, one PDF per ${who} — forward each file to its ${who}. ` +
      "They contain the passwords: delete them from the chat once handed over.";
    try {
      for (let start = 0; start < docs.length; start += 10) {
        const batch = docs.slice(start, start + 10);
        const isLastBatch = start + 10 >= docs.length;
        if (batch.length === 1) {
          await bot.api.sendDocument(userId, new InputFile(batch[0].pdf, batch[0].file), isLastBatch ? { caption } : {});
          continue;
        }
        await bot.api.sendMediaGroup(
          userId,
          batch.map((d, j) =>
            InputMediaBuilder.document(new InputFile(d.pdf, d.file), isLastBatch && j === batch.length - 1 ? { caption } : {}),
          ),
        );
      }
    } catch (err) {
      throw new HttpError(502, `Could not send the files to your chat: ${(err as Error).message}. Send /start to the bot first.`);
    }
    await audit(userId, "invitations_pdf_sent", { council: c?.name ?? null, count: rows.length, separate: true, via: "app" });
    return { ok: true, count: rows.length, files: docs.map((d) => d.file) };
  }
  const pdf = await pdfOf(rows);
  const file = `${prefix}-invitations-${c ? c.code.toLowerCase() : "members"}-${stamp}.pdf`;
  try {
    await bot.api.sendDocument(userId, new InputFile(pdf, file), {
      caption:
        `🎫 ${rows.length} invitation(s) for ${body}. Print it (two per page, cut along the line)` +
        (c ? ` or forward the PDF to the ${w.group.en}. ` : ". ") +
        "It contains the passwords: delete it from the chat once the invitations are handed over.",
    });
  } catch (err) {
    throw new HttpError(502, `Could not send the file to your chat: ${(err as Error).message}. Send /start to the bot first.`);
  }
  await audit(userId, "invitations_pdf_sent", { council: c?.name ?? null, count: rows.length, via: "app" });
  return { ok: true, count: rows.length, file };
}

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
    await bot.api.sendDocument(ctx.user.id, new InputFile(Buffer.from(csv, "utf8"), `${report.words.shortCode.toLowerCase()}-voting-report-${stamp}.csv`), {
      caption: "Raw data — opens in Excel / Google Sheets.",
    });
    await bot.api.sendDocument(ctx.user.id, new InputFile(Buffer.from(html, "utf8"), `${report.words.shortCode.toLowerCase()}-voting-report-${stamp}.html`), {
      caption: "Formatted report — open in a browser, print to PDF if needed.",
    });
  } catch (err) {
    throw new HttpError(502, `Could not send the files to your chat: ${(err as Error).message}. Send /start to the bot first.`);
  }
  let emailedTo: string | null = null;
  let emailError: string | null = null;
  if (wantEmail) {
    try {
      emailedTo = await emailReport(html, csv, report.words);
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
  // Round trip of one Telegram API call from this server — slow egress to
  // Telegram shows up as late group updates and late replies.
  let telegramApiMs: number | null = null;
  try {
    const t0 = Date.now();
    webhook = await webhookStatus(bot);
    telegramApiMs = Date.now() - t0;
  } catch (err) {
    webhookError = (err as Error).message;
  }
  // How the bot stands in the linked group, so the admin can see why a topic
  // rename stayed app-side (it needs the "Manage topics" administrator right).
  let groupRights: { status: string; is_admin: boolean; can_manage_topics: boolean; can_delete_messages: boolean; can_pin_messages: boolean; can_restrict_members: boolean; can_change_info: boolean } | null = null;
  // Which admin-only switches members of the linked group still have (see group-lock.ts).
  let groupLock: GroupLockState | null = null;
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
          can_restrict_members: owner || (isAdmin && Boolean(m.can_restrict_members)),
          can_change_info: owner || (isAdmin && Boolean(m.can_change_info)),
        };
        groupLock = await readLockState(bot.api, linkedChatId);
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
  // Who is in the group without being registered (see bot/gate.ts).
  let people: Record<string, unknown> | null = null;
  if (group) {
    const u = await unregisteredPeople(group.chat_id, bot.botInfo.id);
    people = {
      gate_mode: await getGateMode(),
      seen: u.seen,
      registered: u.registered,
      unregistered: u.unregistered.map((p) => ({
        user_id: p.user_id,
        name: personName(p),
        username: p.username,
        status: p.status,
        source: p.source,
        first_seen_at: p.first_seen_at,
      })),
    };
  }
  return {
    group_rights: groupRights,
    group_lock: groupLock,
    people,
    assembly: await assemblySummary(),
    reset_mode: await getResetMode(),
    group_lock_auto: config.lockGroupPermissions,
    mode: config.serverless ? "serverless" : "server",
    polling: !config.publicUrl,
    public_url: config.publicUrl,
    app_url: appUrl(),
    bot: { id: bot.botInfo.id, username: bot.botInfo.username, name: bot.botInfo.first_name },
    webhook,
    webhook_error: webhookError,
    last_update: getLastUpdate(),
    telegram_api_ms: telegramApiMs,
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
  await setLinkedGroup(chatId, title);
  await upsertTopic({ chat_id: chatId, thread_id: 0, name: "General", chat_title: title });
  await audit(ctx.user.id, "group_linked", { chat_id: chatId, via: "app" });
  return { ok: true };
});

/** (Re)create the "Register / Sign in" topic and post the pinned sign-in card there. */
route("POST", "/setup/group/signin", true, async (ctx) => {
  const group = await getLinkedGroup();
  if (!group) throw new HttpError(409, "No group is linked.");
  const chat = (await bot.api.getChat(group.chat_id)) as unknown as { is_forum?: boolean };
  const result = await ensureSignInTopic(bot.api, group.chat_id, group.title, Boolean(chat.is_forum), { repost: true });
  await audit(ctx.user.id, "signin_card_posted", { chat_id: group.chat_id, thread_id: result.thread_id, created: result.created, via: "app" });
  return result;
});

/** (Re)create the "📖 Commands" topic, pin the bilingual reference, register the command menu and show the command buttons. */
route("POST", "/setup/group/commands", true, async (ctx) => {
  const group = await getLinkedGroup();
  if (!group) throw new HttpError(409, "No group is linked.");
  const chat = (await bot.api.getChat(group.chat_id)) as unknown as { is_forum?: boolean };
  const result = await ensureCommandTopic(bot.api, group.chat_id, group.title, Boolean(chat.is_forum), { repost: true });
  await audit(ctx.user.id, "commands_posted", { chat_id: group.chat_id, thread_id: result.thread_id, created: result.created, via: "app" });
  return result;
});

// ---- Reset -----------------------------------------------------------------

/** Wipe councils, members, invitations, resolutions, ballots, the group and its topics. Admins and the audit log stay. */
route("POST", "/setup/reset", true, async (ctx) => {
  const group = await getLinkedGroup();
  const wiped = await resetAssembly(ctx.user.id, "app");
  if (group) forgetChatMemo(group.chat_id);
  return { ok: true, wiped };
});

route("POST", "/setup/reset-mode", true, async (ctx) => {
  const b = await ctx.body();
  const mode = b.mode === "auto" ? "auto" : "ask";
  await setResetMode(mode);
  await audit(ctx.user.id, "reset_mode_set", { mode, via: "app" });
  return { ok: true, mode };
});

// ---- People in the group (bot/gate.ts) ------------------------------------

route("POST", "/setup/group/gate", true, async (ctx) => {
  const b = await ctx.body();
  const mode = b.mode === "remove" ? "remove" : "flag";
  await setGateMode(mode);
  await audit(ctx.user.id, "group_gate_set", { mode, via: "app" });
  return { ok: true, mode };
});

async function requireLinkedPerson(userId: number) {
  const group = await getLinkedGroup();
  if (!group) throw new HttpError(409, "No group is linked.");
  const person = await getPerson(group.chat_id, userId);
  if (!person) throw new HttpError(404, "The bot has not seen this person in the group.");
  return { group, person };
}

/**
 * Register someone the bot saw in the group and bind their Telegram account at
 * once (the admin vouches for them, so no code is typed). Optional council
 * (sets the vote weight) and role (admin also gets the admin panel).
 */
route("POST", "/setup/group/people/(\\d+)/register", true, async (ctx, [uid]) => {
  const userId = Number(uid);
  const { group, person } = await requireLinkedPerson(userId);
  if (await findByTelegramId(userId)) throw new HttpError(409, "This person is already registered.");
  const b = await ctx.body();
  const name = str(b.name, "Name", { optional: true, max: 120 }) || personName(person);
  const role = b.role === "admin" ? "admin" : "delegate";
  const councilId = str(b.council_id, "Council", { optional: true, max: 60 }) || null;
  const council = councilId ? await getCouncil(councilId) : null;
  if (councilId && !council) throw new HttpError(404, "Council not found.");
  const [row] = await generateCredentials(
    [{ name, region: null, council_id: council?.id ?? null, vote_weight: council?.vote_weight ?? 1 }],
    council?.code ?? (await defaultCodePrefix()),
  );
  const member = await findByToken(row.token_id);
  if (!member) throw new HttpError(500, "Member record not found after creation.");
  await bindTelegram(member.id, userId);
  if (role === "admin") await addDbAdmin(userId, name, ctx.user.id);
  await audit(ctx.user.id, "member_registered_by_admin", {
    user_id: userId, member_id: member.id, token: row.token_id, council_id: council?.id ?? null, role, via: "app",
  });
  if (person.status === "pending") {
    try {
      await approveJoin(bot.api, group.chat_id, userId);
    } catch (err) {
      console.error("approving the join request after registration failed:", err);
    }
  }
  try {
    await bot.api.sendMessage(
      userId,
      `✅ The administrators registered you as <b>${escapeHtml(name)}</b>${council ? ` (${escapeHtml(council.name)})` : ""} for the ${escapeHtml((await orgWords()).assembly)} of ${escapeHtml((await orgWords()).name)}` +
        (role === "admin" ? " and made you an administrator" : "") +
        `. You can vote from here when a resolution opens.`,
      { parse_mode: "HTML", reply_markup: appKeyboard("🗳 Open voting app") },
    );
  } catch {
    // They have not opened the bot yet; they will see it when they do.
  }
  return { ok: true, member: { id: member.id, full_name: name, telegram_user_id: userId, token_id: row.token_id, role } };
});

route("POST", "/setup/group/people/(\\d+)/remove", true, async (ctx, [uid]) => {
  const userId = Number(uid);
  const { group } = await requireLinkedPerson(userId);
  await kickFromGroup(bot.api, group.chat_id, userId);
  await audit(ctx.user.id, "group_member_removed", { chat_id: group.chat_id, user_id: userId, via: "app" });
  return { ok: true };
});

route("POST", "/setup/group/people/(\\d+)/approve", true, async (ctx, [uid]) => {
  const userId = Number(uid);
  const { group, person } = await requireLinkedPerson(userId);
  if (person.status !== "pending") throw new HttpError(409, "No join request is waiting for this person.");
  await approveJoin(bot.api, group.chat_id, userId);
  await audit(ctx.user.id, "join_request_approved", { chat_id: group.chat_id, user_id: userId, via: "app" });
  return { ok: true };
});

route("POST", "/setup/group/people/(\\d+)/decline", true, async (ctx, [uid]) => {
  const userId = Number(uid);
  const { group, person } = await requireLinkedPerson(userId);
  if (person.status !== "pending") throw new HttpError(409, "No join request is waiting for this person.");
  await declineJoin(bot.api, group.chat_id, userId);
  await audit(ctx.user.id, "join_request_declined", { chat_id: group.chat_id, user_id: userId, via: "app" });
  return { ok: true };
});

/** Take the admin-only switches (add members, change info, pin, topics, polls) away from members of the linked group. */
route("POST", "/setup/group/lock", true, async (ctx) => {
  const group = await getLinkedGroup();
  if (!group) throw new HttpError(409, "No group is linked.");
  const result = await lockGroupPermissions(bot.api, group.chat_id);
  await audit(ctx.user.id, "group_locked", { chat_id: group.chat_id, ok: result.ok, reason: result.ok ? null : result.reason, via: "app" });
  return { ...result, lock: await readLockState(bot.api, group.chat_id) };
});

// "Remove the bot from the group": unlink first, so the bot's own departure
// is not taken for a removal by a group admin (which may wipe the data),
// then leave. The assembly data stays.
route("DELETE", "/setup/group", true, async (ctx) => {
  const group = await getLinkedGroup();
  await unlinkGroup();
  if (group) forgetChatMemo(group.chat_id);
  let left = false;
  let reason: string | null = null;
  if (group) {
    try {
      left = await bot.api.leaveChat(group.chat_id);
    } catch (err) {
      reason = (err as Error).message;
      // Already gone from the group: nothing left to do.
      if (/chat not found|not a member|kicked|bot was removed/i.test(reason)) {
        left = true;
        reason = null;
      }
    }
  }
  await audit(ctx.user.id, "group_unlinked", { chat_id: group?.chat_id ?? null, via: "app", left, reason });
  return { ok: true, left, reason };
});

const NO_TOPIC = /thread not found|TOPIC_ID_INVALID|TOPIC_DELETED/i;

/** "New topic": the bot creates it in the linked group, then lists it with the buttons under its message box. */
route("POST", "/setup/topics/new", true, async (ctx) => {
  const name = str((await ctx.body()).name, "Name", { min: 1, max: 128 });
  const linked = await getLinkedGroup();
  if (!linked) throw new HttpError(409, "No group is linked.");
  let threadId: number;
  try {
    threadId = (await bot.api.createForumTopic(linked.chat_id, name)).message_thread_id;
  } catch (err) {
    const reason = (err as Error).message;
    throw new HttpError(/rights|CHAT_ADMIN_REQUIRED|administrator/i.test(reason) ? 403 : 502, `Telegram refused: ${reason}`, "telegram");
  }
  await upsertTopic({ chat_id: linked.chat_id, thread_id: threadId, name, chat_title: linked.title ?? null });
  try {
    await postKeyboard(bot.api, linked.chat_id, threadId, linked.title ?? null);
  } catch (err) {
    console.error("posting the buttons in a new topic failed:", (err as Error).message);
  }
  await audit(ctx.user.id, "topic_created", { chat_id: linked.chat_id, thread_id: threadId, name, via: "app" });
  return { ok: true, thread_id: threadId };
});

route("POST", "/setup/topics", true, async (ctx) => {
  const b = await ctx.body();
  const chatId = int(b.chat_id, "chat_id")!;
  const threadId = int(b.thread_id, "thread_id", { min: 0 })!;
  const name = str(b.name, "Name", { min: 1, max: 128 });
  // Topics live in the linked supergroup only; a stray chat id (e.g. "1") would
  // create a phantom topic that renames and announcements can never reach.
  const linked = await getLinkedGroup();
  if (linked && chatId !== linked.chat_id) throw new HttpError(400, `Chat ID must be the linked group's ID (${linked.chat_id}).`);
  if (!linked && chatId >= 0) throw new HttpError(400, "Chat ID must be a supergroup ID (it starts with -100).");
  // A number that is no topic in the group would be listed but could never be reached.
  if (linked && threadId > 0) {
    try {
      await bot.api.sendChatAction(chatId, "typing", { message_thread_id: threadId });
    } catch (err) {
      if (NO_TOPIC.test((err as Error).message)) {
        throw new HttpError(400, `The group has no topic with ID ${threadId}. Use “New topic” to create one, or copy the ID from the topic's link.`, "no_topic");
      }
    }
  }
  await upsertTopic({ chat_id: chatId, thread_id: threadId, name, chat_title: linked?.title ?? null });
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

/** Read-only topic: only admins post; members get a pinned button panel instead of the message-box buttons. */
route("POST", "/setup/topics/(-?\\d+)/(\\d+)/read-only", true, async (ctx, [chat, thread]) => {
  const on = Boolean((await ctx.body()).on);
  const chatId = Number(chat);
  const threadId = Number(thread);
  if (threadId === 0) throw new HttpError(400, "General cannot be made read-only.");
  const linked = await getLinkedGroup();
  if (!linked || linked.chat_id !== chatId) throw new HttpError(400, "Only topics of the linked group can be made read-only.");
  try {
    await setTopicReadOnly(bot.api, chatId, threadId, on, { title: linked.title });
  } catch (err) {
    const reason = (err as Error).message;
    throw new HttpError(/rights|CHAT_ADMIN_REQUIRED|administrator/i.test(reason) ? 403 : 502, `Telegram refused: ${reason}`, "telegram");
  }
  await audit(ctx.user.id, on ? "topic_read_only" : "topic_opened", { chat_id: chatId, thread_id: threadId, via: "app" });
  return { ok: true, read_only: on };
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
  const limit = Math.min(500, Math.max(1, Number(ctx.query.get("limit") ?? 50) || 50));
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, actor, action, details, created_at")
    .eq("org_id", requireOrgId()) // this organisation's trail only
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return { items: (data ?? []).map((r) => ({ ...r, created_at_local: formatLocal(r.created_at as string) })) };
});
