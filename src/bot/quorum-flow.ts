import { Composer, InlineKeyboard } from "grammy";
import type { Api, Context } from "grammy";
import { audit, supabase } from "../db.js";
import { isAdminUser } from "../services/admins.js";
import { duplicateAsDraft, eligibleFor, extendDeadline, getById, markAwaitingQuorum } from "../services/resolutions.js";
import { ballotCount } from "../services/votes.js";
import { quorumRequired } from "../verdict.js";
import { formatLocal } from "../time.js";
import type { Resolution } from "../types.js";
import { closeResolution } from "./lifecycle.js";
import { notifyAdmins } from "./notify.js";
import { escapeHtml, voteKeyboard } from "./ui.js";

/**
 * A vote whose deadline passes without quorum is not closed: it stays open,
 * the admins choose — extend by X minutes, close as not valid, or close and
 * redo as a fresh draft — and the delegates who have not voted get one
 * reminder. If quorum is reached meanwhile, it closes on its own.
 */

export interface QuorumState {
  ballots: number;
  required: number | null; // null = no quorum set
  met: boolean;
}

export async function quorumState(res: Resolution): Promise<QuorumState> {
  const [ballots, eligible] = await Promise.all([ballotCount(res.id), eligibleFor(res)]);
  const required = quorumRequired(res.quorum, eligible);
  return { ballots, required, met: required === null || ballots >= required };
}

export function waitingKeyboard(res: Resolution): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const m of [5, 10, 15, 30]) kb.text(`+${m} min`, `qx|${res.id}|${m}`);
  return kb
    .row()
    .text("⏱ Extend by other minutes…", `qx|${res.id}|custom`)
    .row()
    .text("✖️ Close as not valid", `qc|${res.id}`)
    .row()
    .text("🔁 Close and redo", `qr|${res.id}`);
}

/** Registered, active delegates who have not cast a ballot on `res`: one private reminder each. */
async function remindNonVoters(api: Api, res: Resolution): Promise<number> {
  const [{ data: members, error }, { data: ballots, error: bErr }] = await Promise.all([
    supabase.from("members").select("id, telegram_user_id").not("telegram_user_id", "is", null).eq("is_active", true),
    supabase.from("ballots").select("member_id").eq("resolution_id", res.id),
  ]);
  if (error) throw error;
  if (bErr) throw bErr;
  const voted = new Set((ballots ?? []).map((b) => String(b.member_id)));
  let sent = 0;
  for (const m of members ?? []) {
    if (voted.has(String(m.id))) continue;
    try {
      await api.sendMessage(
        Number(m.telegram_user_id),
        `⏳ <b>${escapeHtml(res.code)} — ${escapeHtml(res.title)}</b> is still open: not enough delegates have voted for the result to be valid. Please cast your ballot now.`,
        { parse_mode: "HTML", reply_markup: voteKeyboard(res) },
      );
      sent++;
    } catch {
      // Never opened the bot, or blocked it.
    }
  }
  return sent;
}

/**
 * Called for each open resolution whose deadline has passed. Returns the
 * results text when it was closed, null when it stays open waiting for quorum.
 */
export async function handleDeadline(api: Api, res: Resolution): Promise<string | null> {
  const q = await quorumState(res);
  if (q.met) return closeResolution(api, res, res.awaiting_quorum_since ? "system:quorum-reached" : "system:auto-close");
  if (await markAwaitingQuorum(res.id)) {
    console.log(`${res.code}: deadline passed without quorum (${q.ballots} of ${q.required}) — kept open, admins asked`);
    await audit("system:auto-close", "deadline_without_quorum", { resolution: res.code, ballots: q.ballots, required: q.required });
    await notifyAdmins(
      api,
      `⏰ <b>${escapeHtml(res.code)} — ${escapeHtml(res.title)}</b> reached its deadline <b>without quorum</b>: ` +
        `${q.ballots} of ${q.required} ballots needed. Voting stays open — it closes by itself as soon as quorum is reached.\n\n` +
        `Extend the deadline, close it as not valid, or close it and prepare the same resolution again as a new draft.`,
      waitingKeyboard(res),
    );
    const reminded = await remindNonVoters(api, res);
    if (reminded) console.log(`${res.code}: reminded ${reminded} delegate(s) who have not voted`);
  }
  return null;
}

// ---------------------------------------------------------------- admin actions (shared with the Mini App)

export async function extendVote(res: Resolution, minutes: number, by: number | string): Promise<Date> {
  const closesAt = await extendDeadline(res.id, minutes);
  await audit(by, "resolution_extended", { resolution: res.code, minutes, closes_at: closesAt.toISOString() });
  return closesAt;
}

/** Close a waiting vote (verdict: quorum not reached); with `redo`, also create a fresh draft copy. */
export async function closeWaiting(api: Api, res: Resolution, by: number | string, redo: boolean): Promise<{ text: string | null; draft: Resolution | null }> {
  const text = await closeResolution(api, res, by);
  let draft: Resolution | null = null;
  if (text && redo) {
    draft = await duplicateAsDraft(res);
    await audit(by, "resolution_redo", { resolution: res.code, draft: draft.code });
  }
  return { text, draft };
}

// ---------------------------------------------------------------- buttons in the admin's private chat

export const quorumComposer = new Composer<Context>();

// Admins asked "extend by how many minutes?": Telegram user id → resolution id.
const awaitingMinutes = new Map<number, string>();

async function openResolutionFor(ctx: Context, id: string): Promise<Resolution | null> {
  if (!(await isAdminUser(ctx.from?.id))) {
    await ctx.answerCallbackQuery({ text: "Admins only.", show_alert: true });
    return null;
  }
  const res = await getById(id);
  if (!res || res.status !== "open") {
    await ctx.answerCallbackQuery({ text: "This vote is no longer open.", show_alert: true });
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch {
      // Already edited.
    }
    return null;
  }
  return res;
}

quorumComposer.callbackQuery(/^qx\|([0-9a-f-]{36})\|(\d+|custom)$/, async (ctx) => {
  const res = await openResolutionFor(ctx, ctx.match[1]);
  if (!res) return;
  if (ctx.match[2] === "custom") {
    awaitingMinutes.set(ctx.from.id, res.id);
    await ctx.answerCallbackQuery();
    await ctx.reply(`⏱ By how many minutes should voting on <b>${escapeHtml(res.code)}</b> be extended? Send a number, e.g. <code>20</code>.`, { parse_mode: "HTML" });
    return;
  }
  const minutes = Number(ctx.match[2]);
  const closesAt = await extendVote(res, minutes, ctx.from.id);
  await ctx.answerCallbackQuery({ text: `Extended by ${minutes} min.` });
  await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  await ctx.reply(`⏱ <b>${escapeHtml(res.code)}</b>: voting extended by ${minutes} min, now closing at <b>${formatLocal(closesAt)}</b>.`, { parse_mode: "HTML" });
});

quorumComposer.callbackQuery(/^q(c|r)\|([0-9a-f-]{36})$/, async (ctx) => {
  const res = await openResolutionFor(ctx, ctx.match[2]);
  if (!res) return;
  const redo = ctx.match[1] === "r";
  const { text, draft } = await closeWaiting(ctx.api, res, ctx.from.id, redo);
  await ctx.answerCallbackQuery({ text: redo ? "Closed; new draft created." : "Closed as not valid." });
  await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  if (!text) return;
  await ctx.reply(
    `🔴 <b>${escapeHtml(res.code)}</b> closed — quorum not reached, the vote is not valid.` +
      (draft ? `\n🔁 New draft <b>${escapeHtml(draft.code)}</b> with the same wording is ready; open it when the meeting is ready to vote again.` : ""),
    { parse_mode: "HTML" },
  );
});

// The custom number of minutes, typed in the private chat.
quorumComposer.chatType("private").on("message:text", async (ctx, next) => {
  const id = awaitingMinutes.get(ctx.from.id);
  if (!id) return next();
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) {
    awaitingMinutes.delete(ctx.from.id);
    return next();
  }
  const minutes = Number(text);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60) {
    await ctx.reply("Send a whole number of minutes between 1 and 1440, e.g. 20.");
    return;
  }
  awaitingMinutes.delete(ctx.from.id);
  if (!(await isAdminUser(ctx.from.id))) return;
  const res = await getById(id);
  if (!res || res.status !== "open") {
    await ctx.reply("This vote is no longer open.");
    return;
  }
  const closesAt = await extendVote(res, minutes, ctx.from.id);
  await ctx.reply(`⏱ <b>${escapeHtml(res.code)}</b>: voting extended by ${minutes} min, now closing at <b>${formatLocal(closesAt)}</b>.`, { parse_mode: "HTML" });
});
