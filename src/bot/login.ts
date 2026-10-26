import type { Context } from "grammy";
import { checkToken, verifyAndBind } from "../services/members.js";
import { config } from "../config.js";
import { appKeyboard } from "./ui.js";
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

export function inLogin(userId: number): boolean {
  return sessions.has(userId);
}

export async function promptLogin(ctx: Context): Promise<void> {
  beginLogin(ctx.from!.id);
  const kb = appKeyboard("📱 Register in the app");
  await ctx.reply(
    "👋 Welcome to the ESA General Assembly Voting System.\n\n" +
      (kb
        ? "Tap the button below to register in the app, or send your <b>Voting Token ID</b> here now.\n"
        : "To register, please send your <b>Voting Token ID</b> now.\n") +
      "It was issued to you by the National Office (example format: <code>ESA-2026-K7M2P</code>).",
    { parse_mode: "HTML", reply_markup: kb },
  );
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
        await ctx.reply("❌ That token was not recognized. Check for typos and send it again, or contact the National Office.");
        return null;
      case "conflict":
        sessions.delete(userId);
        await ctx.reply("⚠️ This token is already registered to another Telegram account. If you believe this is an error, contact the National Office immediately.");
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
      await ctx.reply("⚠️ This token was just registered to another Telegram account. Contact the National Office.");
      return null;
    default:
      sessions.delete(userId);
      await ctx.reply("🔒 This token is temporarily locked or no longer active. Please try again later with /start.");
      return null;
  }
}
