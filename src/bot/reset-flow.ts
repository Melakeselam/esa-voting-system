import { Composer, InlineKeyboard } from "grammy";
import type { Api, Context } from "grammy";
import { isAdminUser } from "../services/admins.js";
import { assemblySummary, getResetMode, resetAssembly, summaryText } from "../services/reset.js";
import { notifyAdmins } from "./notify.js";
import { escapeHtml } from "./ui.js";

/**
 * The bot was removed from the assembly group (or the group was deleted —
 * Telegram sends the same event for both). Depending on the reset mode the
 * assembly data is wiped at once, or the admins are offered the wipe with a
 * two-tap confirmation so an accidental removal never destroys the roster.
 */
export async function onBotRemoved(api: Api, groupTitle: string | null, byUserId: number): Promise<void> {
  const title = groupTitle ?? "the assembly group";
  const mode = await getResetMode();
  if (mode === "auto") {
    const wiped = await resetAssembly(byUserId, "removed_from_group_auto");
    console.log(`Assembly data wiped after removal from "${title}": ${summaryText(wiped)}`);
    await notifyAdmins(
      api,
      `🗑 I was removed from <b>${escapeHtml(title)}</b> and, as set in Setup, wiped the assembly data: ${escapeHtml(summaryText(wiped))}. ` +
        `Add me to the new group as administrator to start fresh.`,
    );
    return;
  }
  const s = await assemblySummary();
  const kb = new InlineKeyboard().text("🗑 Reset assembly data", "reset|ask").text("Keep", "reset|keep");
  await notifyAdmins(
    api,
    `👋 I was removed from <b>${escapeHtml(title)}</b>. The assembly data is kept: ${escapeHtml(summaryText(s))}.\n` +
      `If that group was deleted and you are starting over, reset the data so the new group begins clean. ` +
      `Setup › “Reset assembly data” does the same later.`,
    kb,
  );
}

export const resetComposer = new Composer<Context>();

resetComposer.callbackQuery(/^reset\|(ask|yes|keep)$/, async (ctx) => {
  const action = ctx.match[1];
  if (!(await isAdminUser(ctx.from.id))) {
    await ctx.answerCallbackQuery({ text: "Admins only.", show_alert: true });
    return;
  }
  if (action === "keep") {
    await ctx.answerCallbackQuery({ text: "Kept." });
    await ctx.editMessageText("✅ The assembly data is kept. You can reset it later from Setup.", { reply_markup: undefined });
    return;
  }
  if (action === "ask") {
    const s = await assemblySummary();
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `⚠️ This deletes ${escapeHtml(summaryText(s))}, the learned group and its topics. Admin accounts and the audit log stay. <b>This cannot be undone.</b>`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("✅ Yes, wipe everything", "reset|yes").text("↩️ Cancel", "reset|keep"),
      },
    );
    return;
  }
  const wiped = await resetAssembly(ctx.from.id, "removed_from_group");
  await ctx.answerCallbackQuery({ text: "Assembly data wiped." });
  await ctx.editMessageText(`🗑 Wiped: ${escapeHtml(summaryText(wiped))}. Add me to the new group as administrator to start fresh.`, {
    parse_mode: "HTML",
    reply_markup: undefined,
  });
});
