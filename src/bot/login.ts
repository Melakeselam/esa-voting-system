import type { Context } from "grammy";
import { checkToken, verifyAndBind } from "../services/members.js";
import { approvePendingJoin } from "./gate.js";
import { currentOrg, PLATFORM_NAME, setActiveOrg, wordsOf } from "../services/orgs.js";
import { config } from "../config.js";
import { appKeyboard, escapeHtml } from "./ui.js";
import type { Member } from "../types.js";

interface LoginState {
  step: "token" | "password";
  member?: Member;
}

// Login is a short two-step exchange, so in-memory state is sufficient;
// if the server restarts mid-login, the member simply sends /start again.
const sessions = new Map<number, LoginState>();

export function beginLogin(userId: number): void {
  sessions.set(userId, { step: "token" });
}

/** Invitation link already carried the token: continue at the password step. */
export function beginLoginWithToken(userId: number, member: Member): void {
  sessions.set(userId, { step: "password", member });
}

export function inLogin(userId: number): boolean {
  return sessions.has(userId);
}

/** The organisation of the invitation this person is registering with, once the code has been recognised. */
export function sessionOrgId(userId: number): string | null {
  return sessions.get(userId)?.member?.org_id ?? null;
}

export async function promptLogin(ctx: Context): Promise<void> {
  beginLogin(ctx.from!.id);
  const kb = appKeyboard("📱 Register in the app");
  // Inside an organisation the welcome names it; otherwise the code itself will tell which one.
  const org = await currentOrg();
  const w = wordsOf(org);
  await ctx.reply(
    `👋 Welcome to ${escapeHtml(org ? `the ${w.assembly} of ${w.name}` : PLATFORM_NAME)} — ${escapeHtml(PLATFORM_NAME)}.\n\n` +
      (kb
        ? "Tap the button below to register in the app, or send your <b>Voting Token ID</b> here now.\n"
        : "To register, please send your <b>Voting Token ID</b> now.\n") +
      `It is printed on the invitation ${escapeHtml(org ? `the ${w.office} gave you` : "your organisation gave you")} (example format: <code>${escapeHtml(w.shortCode)}-2026-K7M2P</code>).`,
    { parse_mode: "HTML", reply_markup: kb },
  );
}

/** "the Secretariat" / "your organisation" — who to contact about an invitation. */
async function contact(): Promise<string> {
  const org = await currentOrg();
  return org ? `the ${wordsOf(org).office}` : "your organisation";
}

/**
 * Handles the token → password exchange in a private chat.
 * Returns the member once login completes, or null while still in progress.
 */
export async function handleLoginMessage(ctx: Context): Promise<Member | null> {
  const userId = ctx.from!.id;
  const state = sessions.get(userId);
  const text = ctx.message?.text?.trim();
  if (!state || !text) return null;

  if (state.step === "token") {
    const check = await checkToken(text, userId);
    switch (check.status) {
      case "unknown_token":
        await ctx.reply(`❌ That token was not recognized. Check for typos and send it again, or contact ${await contact()}.`);
        return null;
      case "conflict":
        sessions.delete(userId);
        await ctx.reply(`⚠️ This token is already registered to another Telegram account. If you believe this is an error, contact ${await contact()} immediately.`);
        return null;
      case "locked":
        await ctx.reply(`🔒 This token is temporarily locked after too many failed attempts. Try again in ${config.lockMinutes} minutes.`);
        return null;
    }
    state.member = check.member;
    state.step = "password";
    await ctx.reply("🔑 Token found. Now send your <b>password</b>.\n\nYour message will be deleted immediately after checking.", { parse_mode: "HTML" });
    return null;
  }

  // Password step — delete the message containing the password right away.
  try {
    await ctx.deleteMessage();
  } catch {
    // Deletion can fail if the message is too old; nothing more we can do.
  }

  const result = await verifyAndBind(state.member!, text, userId);
  switch (result.status) {
    case "ok":
      sessions.delete(userId);
      await setActiveOrg(userId, result.member.org_id); // this chat is now about the organisation they joined
      void approvePendingJoin(ctx.api, userId); // let them into the group if they asked to join before registering
      return result.member;
    case "wrong_password":
      await ctx.reply("❌ Wrong password. Please send the password again.");
      return null;
    case "locked_now":
      sessions.delete(userId);
      await ctx.reply(`❌ Wrong password. The token is now locked for ${config.lockMinutes} minutes.`);
      return null;
    case "conflict":
      sessions.delete(userId);
      await ctx.reply(`⚠️ This token was just registered to another Telegram account. Contact ${await contact()}.`);
      return null;
    default:
      sessions.delete(userId);
      await ctx.reply("🔒 This token is temporarily locked or no longer active. Please try again later with /start.");
      return null;
  }
}
