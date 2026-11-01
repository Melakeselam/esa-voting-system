import type { Context } from "grammy";
import { audit } from "../db.js";
import { orgByGroupChat } from "../services/orgs.js";
import { escapeHtml } from "./ui.js";

/**
 * Kene Voting System runs an assembly in a group with Topics (a sign-in topic
 * and a commands topic). Telegram gives bots no way to switch Topics on, so
 * when the bot is added to a group without them it says so in the group,
 * tells the person who added it how to fix it, and leaves. They switch Topics
 * on and add the bot again.
 *
 * Only for groups no organisation has linked yet: leaving a linked group
 * counts as removal from the assembly group, which can wipe its data.
 */
export const TOPICS_REQUIRED_BANNER =
  "⚠️ <b>Topics are off in this group.</b>\n" +
  "Kene Voting System needs Topics: members sign in and find the commands in their own topics.\n\n" +
  "<b>To fix it:</b> group info › Edit › <b>Topics</b> → on, then add me again as an administrator.\n" +
  "I am leaving this group for now.\n\n" +
  "⚠️ <b>በዚህ ቡድን ውስጥ ርዕሶች (Topics) አልበሩም።</b>\n" +
  "የቡድን መረጃ › አርትዕ › <b>Topics</b> ያብሩ፣ ከዚያ እንደ አስተዳዳሪ እንደገና ያክሉኝ። ለአሁን ከቡድኑ እወጣለሁ።";

/** True when the update was a refused addition and nothing else should handle it. */
export async function refuseGroupWithoutTopics(ctx: Context): Promise<boolean> {
  const upd = ctx.myChatMember;
  if (!upd) return false;
  const chat = upd.chat;
  if (chat.type !== "group" && chat.type !== "supergroup") return false;
  const status = upd.new_chat_member.status;
  if (status !== "member" && status !== "administrator") return false;
  if (chat.type === "supergroup" && "is_forum" in chat && chat.is_forum) return false;
  if (chat.type === "supergroup") {
    // Confirm with Telegram before leaving; when in doubt, stay.
    try {
      const full = (await ctx.api.getChat(chat.id)) as { is_forum?: boolean };
      if (full.is_forum) return false;
    } catch {
      return false;
    }
  }
  // Already an organisation's group (e.g. its topics were switched off later): never leave it.
  if (await orgByGroupChat(chat.id)) return false;

  const title = ("title" in chat ? chat.title : undefined) ?? String(chat.id);
  const adder = upd.from;
  try {
    await ctx.api.sendMessage(chat.id, TOPICS_REQUIRED_BANNER, { parse_mode: "HTML" });
  } catch (err) {
    console.error(`topics banner in ${chat.id} failed:`, (err as Error).message);
  }
  if (!adder.is_bot) {
    try {
      await ctx.api.sendMessage(
        adder.id,
        `⚠️ You added me to <b>${escapeHtml(title)}</b>, but Topics are off there, so I left.\n\n` +
          `1. Open the group › group info › Edit.\n` +
          `2. Turn on <b>Topics</b>.\n` +
          `3. Add me again as an administrator.\n\n` +
          `I then create the sign-in and commands topics and ask which organisation the group is for.`,
        { parse_mode: "HTML" },
      );
    } catch {
      // Never opened a private chat with the bot: the banner in the group has to do.
    }
  }
  try {
    await ctx.api.leaveChat(chat.id);
  } catch (err) {
    console.error(`leaving ${chat.id} failed:`, (err as Error).message);
  }
  console.log(`Added to "${title}" (${chat.id}) without Topics — warned and left`);
  await audit(adder.id, "group_refused_no_topics", { chat_id: chat.id, chat_type: chat.type });
  return true;
}
