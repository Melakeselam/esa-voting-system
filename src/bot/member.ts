import { Composer } from "grammy";
import type { Context } from "grammy";
import { audit } from "../db.js";
import { findByTelegramId } from "../services/members.js";
import { getById, listResolutions } from "../services/resolutions.js";
import { castVote, memberBallots } from "../services/votes.js";
import { handleLoginMessage, inLogin, promptLogin } from "./login.js";
import { appKeyboard, confirmKeyboard, escapeHtml, resolutionCard, voteKeyboard } from "./ui.js";
import type { InlineKeyboard } from "grammy";

/** Member-facing handlers. Everything here runs in private chats only. */
export const memberComposer = new Composer<Context>();
const pm = memberComposer.chatType("private");

const HELP =
  "🗳 <b>ESA Voting Bot — Commands</b>\n\n" +
  "/vote — show resolutions currently open for voting\n" +
  "/status — your registration and ballots cast\n" +
  "/help — this message\n\n" +
  "Voting is done by tapping a button under a resolution, or in the app (menu button next to the message box). " +
  "For secret ballots your choice is anonymous and cannot be changed.";

pm.command("start", async (ctx) => {
  const member = await findByTelegramId(ctx.from!.id);
  if (!member) {
    await promptLogin(ctx);
    return;
  }

  // Deep link from a group announcement: /start vote_<resolutionId>
  const payload = ctx.match;
  if (typeof payload === "string" && payload.startsWith("vote_")) {
    const res = await getById(payload.slice("vote_".length));
    if (res && res.status === "open") {
      await ctx.reply(resolutionCard(res), { parse_mode: "HTML", reply_markup: voteKeyboard(res) });
      return;
    }
  }

  await ctx.reply(
    `✅ You are registered as <b>${escapeHtml(member.full_name ?? member.token_id)}</b>.\n\n${HELP}`,
    { parse_mode: "HTML", reply_markup: appKeyboard("🗳 Open voting app") },
  );
});

pm.command("help", (ctx) =>
  ctx.reply(HELP, { parse_mode: "HTML", reply_markup: appKeyboard("🗳 Open voting app") }),
);

pm.command("whoami", (ctx) =>
  ctx.reply(`Your Telegram ID: <code>${ctx.from!.id}</code>`, { parse_mode: "HTML" }),
);

pm.command("vote", async (ctx) => {
  const member = await findByTelegramId(ctx.from!.id);
  if (!member) {
    await promptLogin(ctx);
    return;
  }
  const open = await listResolutions("open");
  if (open.length === 0) {
    await ctx.reply("There are no resolutions open for voting right now. You will find them here when voting opens.", {
      reply_markup: appKeyboard("🗳 Open voting app"),
    });
    return;
  }
  const voted = await memberBallots(member.id);
  for (const res of open) {
    const suffix = voted.has(res.id) ? "\n\n☑️ You have already cast your ballot on this resolution." : "";
    await ctx.reply(resolutionCard(res) + suffix, {
      parse_mode: "HTML",
      reply_markup: voteKeyboard(res),
    });
  }
});

pm.command("status", async (ctx) => {
  const member = await findByTelegramId(ctx.from!.id);
  if (!member) {
    await promptLogin(ctx);
    return;
  }
  const [all, voted] = await Promise.all([listResolutions(), memberBallots(member.id)]);
  const lines = [
    `👤 Registered as: <b>${escapeHtml(member.full_name ?? member.token_id)}</b>`,
    `🎫 Token: <code>${escapeHtml(member.token_id)}</code>`,
    "",
    "<b>Resolutions:</b>",
  ];
  if (all.length === 0) lines.push("(none created yet)");
  for (const res of all) {
    const state = res.status === "open" ? "🟢 open" : res.status === "closed" ? "🔴 closed" : "⚪ draft";
    const ballot = voted.has(res.id) ? " — ☑️ ballot cast" : res.status === "open" ? " — ⏳ not voted yet" : "";
    lines.push(`${escapeHtml(res.code)}: ${escapeHtml(res.title)} (${state})${ballot}`);
  }
  await ctx.reply(lines.join("\n"), { parse_mode: "HTML", reply_markup: appKeyboard("🗳 Open voting app") });
});

/**
 * Rewrite the ballot message in place (card + status line + keyboard).
 * Telegram rejects edits that change nothing, and very old messages cannot
 * be edited — both are harmless here, so failures are swallowed.
 */
async function editBallot(ctx: Context, text: string, keyboard?: InlineKeyboard): Promise<void> {
  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
  } catch {
    // "message is not modified" / message too old — ignore.
  }
}

// Step 1 — option tapped: ask for confirmation, nothing is recorded yet.
memberComposer.callbackQuery(/^v\|([0-9a-f-]{36})\|(\d+)$/, async (ctx) => {
  const member = await findByTelegramId(ctx.from.id);
  if (!member || !member.is_active) {
    await ctx.answerCallbackQuery({ text: "Please register first: send /start to the bot.", show_alert: true });
    return;
  }
  const res = await getById(ctx.match[1]);
  if (!res) {
    await ctx.answerCallbackQuery({ text: "This resolution no longer exists.", show_alert: true });
    return;
  }
  if (res.status !== "open") {
    await ctx.answerCallbackQuery({ text: "Voting is not open for this resolution.", show_alert: true });
    await editBallot(ctx, resolutionCard(res));
    return;
  }
  const choiceIndex = Number(ctx.match[2]);
  const option = res.options[choiceIndex];
  if (option === undefined) {
    await ctx.answerCallbackQuery({ text: "Unknown option. Please use /vote to get a fresh ballot.", show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();
  await editBallot(
    ctx,
    resolutionCard(res) +
      `\n\n👉 You selected: <b>${escapeHtml(option)}</b>` +
      (res.anonymous ? "\n🔒 Once confirmed, a secret-ballot vote is final." : "") +
      "\n\nConfirm your vote?",
    confirmKeyboard(res, choiceIndex),
  );
});

// Step 2 — confirmed: record the ballot.
memberComposer.callbackQuery(/^vc\|([0-9a-f-]{36})\|(\d+)$/, async (ctx) => {
  const member = await findByTelegramId(ctx.from.id);
  if (!member || !member.is_active) {
    await ctx.answerCallbackQuery({ text: "Please register first: send /start to the bot.", show_alert: true });
    return;
  }
  const res = await getById(ctx.match[1]);
  if (!res) {
    await ctx.answerCallbackQuery({ text: "This resolution no longer exists.", show_alert: true });
    return;
  }
  const choiceIndex = Number(ctx.match[2]);
  const option = res.options[choiceIndex] ?? "?";

  const outcome = await castVote(res.id, member.id, choiceIndex);
  switch (outcome) {
    case "ok":
      await audit(ctx.from.id, "vote_cast", { resolution: res.code, anonymous: res.anonymous });
      await ctx.answerCallbackQuery({ text: "✅ Ballot recorded. Thank you!", show_alert: true });
      await editBallot(
        ctx,
        resolutionCard(res) +
          (res.anonymous
            ? "\n\n✅ Your ballot has been recorded (secret ballot — your choice is stored anonymously and cannot be changed)."
            : `\n\n✅ Your ballot: <b>${escapeHtml(option)}</b>. You may change it until voting closes.`),
        res.anonymous ? undefined : voteKeyboard(res),
      );
      break;
    case "changed":
      await audit(ctx.from.id, "vote_changed", { resolution: res.code });
      await ctx.answerCallbackQuery({ text: `✅ Vote changed to: ${option}`, show_alert: true });
      await editBallot(
        ctx,
        resolutionCard(res) +
          `\n\n✅ Your ballot: <b>${escapeHtml(option)}</b>. You may change it until voting closes.`,
        voteKeyboard(res),
      );
      break;
    case "already_voted":
      await ctx.answerCallbackQuery({
        text: "You have already voted on this secret ballot; votes cannot be changed.",
        show_alert: true,
      });
      await editBallot(
        ctx,
        resolutionCard(res) + "\n\n☑️ You have already cast your ballot on this resolution.",
      );
      break;
    case "not_open":
      await ctx.answerCallbackQuery({ text: "Voting is not open for this resolution.", show_alert: true });
      await editBallot(ctx, resolutionCard(res));
      break;
    default:
      await ctx.answerCallbackQuery({ text: "Could not record your vote. Please try again.", show_alert: true });
  }
});

// Step 3 — back: restore the ballot with the option keyboard.
memberComposer.callbackQuery(/^vb\|([0-9a-f-]{36})$/, async (ctx) => {
  const res = await getById(ctx.match[1]);
  await ctx.answerCallbackQuery();
  if (!res) return;
  await editBallot(
    ctx,
    resolutionCard(res),
    res.status === "open" ? voteKeyboard(res) : undefined,
  );
});

// Free text in private chat: either part of a login exchange, or a hint.
pm.on("message:text", async (ctx) => {
  if (inLogin(ctx.from.id)) {
    const member = await handleLoginMessage(ctx);
    if (member) {
      await ctx.reply(
        `🎉 Registration complete, <b>${escapeHtml(member.full_name ?? member.token_id)}</b>!\n\n${HELP}`,
        { parse_mode: "HTML" },
      );
      const open = await listResolutions("open");
      for (const res of open) {
        await ctx.reply(resolutionCard(res), { parse_mode: "HTML", reply_markup: voteKeyboard(res) });
      }
    }
    return;
  }
  const member = await findByTelegramId(ctx.from.id);
  if (!member) {
    await promptLogin(ctx);
  } else {
    await ctx.reply("Use /vote to see open resolutions, or /help for all commands.");
  }
});
