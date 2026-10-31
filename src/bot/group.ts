import { Composer, InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import { audit } from "../db.js";
import { config } from "../config.js";
import { isAdminUser } from "../services/admins.js";
import { notifyAdmins } from "./notify.js";
import { escapeHtml } from "./ui.js";
import { lockGroupPermissions } from "./group-lock.js";
import { onBotPromoted } from "./gate.js";
import { onBotRemoved } from "./reset-flow.js";
import { getLinkedGroup, setSetting, unlinkGroup, upsertTopic } from "../services/settings.js";

/**
 * Learns the assembly group and its forum topics from the updates the bot
 * sees (it is an admin of the group, so it sees every message). The Mini App
 * uses this list to let an admin pick where to announce a resolution, instead
 * of having to run /announce inside the topic.
 */
export const groupComposer = new Composer<Context>();

// Per-process memo so a busy group does not cause a database write per message.
const seen = new Set<string>();

/** Drop everything memoised for a chat, so the next update re-reads the database (after an unlink). */
export function forgetChatMemo(chatId: number): void {
  for (const k of [...seen]) if (k.startsWith(`${chatId}:`)) seen.delete(k);
}

export interface LastUpdate {
  at: string;
  kind: string;
  chat_id: number | null;
  chat_type: string | null;
  chat_title: string | null;
  thread_id: number | null;
}
let lastUpdate: LastUpdate | null = null;

/**
 * The most recent update this process received from Telegram. Setup › Health
 * shows it so an admin can tell "the bot never saw my message" apart from
 * "the bot saw it and did something else with it".
 */
export function getLastUpdate(): LastUpdate | null {
  return lastUpdate;
}

groupComposer.use(async (ctx, next) => {
  const chat = ctx.chat ?? ctx.myChatMember?.chat ?? null;
  lastUpdate = {
    at: new Date().toISOString(),
    kind: Object.keys(ctx.update).find((k) => k !== "update_id") ?? "unknown",
    chat_id: chat?.id ?? null,
    chat_type: chat?.type ?? null,
    chat_title: chat && "title" in chat ? (chat.title ?? null) : null,
    thread_id: ctx.message?.is_topic_message ? (ctx.message.message_thread_id ?? null) : null,
  };
  try {
    await track(ctx);
  } catch (err) {
    console.error("group tracking failed:", err);
  }
  await next();
});

async function track(ctx: Context): Promise<void> {
  const chat = ctx.chat ?? ctx.myChatMember?.chat;
  if (!chat || (chat.type !== "supergroup" && chat.type !== "group")) return;
  const title = "title" in chat ? chat.title : null;

  // Bot added to (or promoted in) a group.
  if (ctx.myChatMember) {
    const status = ctx.myChatMember.new_chat_member.status;
    if (status === "left" || status === "kicked") {
      // Bot removed from the group: forget it and its topics so Setup stops showing them.
      const linked = await getLinkedGroup();
      console.log(`Bot ${status} group "${title ?? chat.id}" (${chat.id})${linked?.chat_id === chat.id ? " — unlinking it" : ""}`);
      if (linked?.chat_id === chat.id) {
        await unlinkGroup(chat.id);
        await audit(ctx.myChatMember.from.id, "group_unlinked", { chat_id: chat.id, via: "removed_from_group" });
        forgetChatMemo(chat.id);
        // Offer (or perform) the wipe of the assembly data, per the reset mode in Setup.
        try {
          await onBotRemoved(ctx.api, title, ctx.myChatMember.from.id);
        } catch (err) {
          console.error("reset offer after removal failed:", err);
        }
        return;
      }
      forgetChatMemo(chat.id);
      departed.add(chat.id);
      return;
    }
    // Added or promoted: rare, so always re-read the stored link instead of trusting the memo.
    departed.delete(chat.id);
    forgetChatMemo(chat.id);
    await linkOrSwitch(ctx, chat.id, title);
    await upsertTopic({ chat_id: chat.id, thread_id: 0, name: "General", chat_title: title });
    seen.add(`${chat.id}:0`);
    if (status === "administrator") {
      // Made admin of the assembly group: tell the room and the admins what happens now.
      const linked = await getLinkedGroup();
      if (linked?.chat_id === chat.id) await onBotPromoted(ctx.api, chat.id, title, "is_forum" in chat && Boolean(chat.is_forum));
    }
    if (status === "administrator" && config.lockGroupPermissions) {
      // Made admin of the assembly group: take the admin-only switches away from members.
      const linked = await getLinkedGroup();
      if (linked?.chat_id === chat.id) {
        const result = await lockGroupPermissions(ctx.api, chat.id);
        console.log(
          result.ok
            ? `Locked member permissions in "${title ?? chat.id}" (${chat.id})`
            : `Could not lock member permissions in "${title ?? chat.id}" (${chat.id}): ${result.reason}`,
        );
        await audit(ctx.myChatMember.from.id, "group_locked", {
          chat_id: chat.id,
          ok: result.ok,
          reason: result.ok ? null : result.reason,
          via: "promoted",
        });
      }
    }
    return;
  }

  const msg = ctx.message;
  if (!msg) return;
  // Trailing updates from a group the bot has just left (the "bot left" service
  // message, a deleted group's last events) must never link that group again.
  if (departed.has(chat.id) || msg.left_chat_member?.id === ctx.me.id) return;
  const name = msg.forum_topic_created?.name ?? msg.forum_topic_edited?.name ?? null;
  const inTopic = Boolean(msg.is_topic_message || msg.forum_topic_created || msg.forum_topic_edited);
  const threadId = inTopic ? (msg.message_thread_id ?? 0) : 0;
  const key = `${chat.id}:${threadId}`;
  if (seen.has(key) && !name) return;

  await linkGroupIfUnset(chat.id, title);
  if (!seen.has(`${chat.id}:0`)) {
    await upsertTopic({ chat_id: chat.id, thread_id: 0, name: "General", chat_title: title });
    seen.add(`${chat.id}:0`);
  }
  if (threadId !== 0) {
    await upsertTopic({ chat_id: chat.id, thread_id: threadId, name, chat_title: title });
    seen.add(key);
    console.log(`Learned topic #${threadId}${name ? ` "${name}"` : ""} in "${title ?? chat.id}" (${chat.id})`);
  }
}

// Groups the bot was removed from in this process; cleared when it is added back.
const departed = new Set<number>();

/** Is the bot still in this group? Telegram answers an error for a deleted group or a removed bot. */
async function botStillIn(ctx: Context, chatId: number): Promise<boolean> {
  try {
    const m = await ctx.api.getChatMember(chatId, ctx.me.id);
    return m.status !== "left" && m.status !== "kicked";
  } catch {
    return false;
  }
}

/**
 * The bot was added to (or promoted in) a group. Link it when no group is
 * linked. When another group is linked: if the bot is no longer in that one
 * (deleted, or removed while the server was not listening) switch to the new
 * group at once; otherwise keep the assembly group and ask the admins.
 */
async function linkOrSwitch(ctx: Context, chatId: number, title: string | null): Promise<void> {
  const linked = await getLinkedGroup();
  if (linked && linked.chat_id !== chatId) {
    if (await botStillIn(ctx, linked.chat_id)) {
      await notifyAdmins(
        ctx.api,
        `ℹ️ I was added to <b>${escapeHtml(title ?? String(chatId))}</b>, but <b>${escapeHtml(linked.title ?? String(linked.chat_id))}</b> is still the assembly group, so I set nothing up in the new one.`,
        new InlineKeyboard().text("🔁 Use the new group instead", `gswitch|${chatId}`),
      );
      console.log(`Added to "${title ?? chatId}" (${chatId}) while "${linked.title ?? linked.chat_id}" is still linked — asked the admins`);
      return;
    }
    console.log(`Linked group "${linked.title ?? linked.chat_id}" (${linked.chat_id}) is gone — switching to "${title ?? chatId}" (${chatId})`);
    await unlinkGroup(linked.chat_id);
    forgetChatMemo(linked.chat_id);
    await audit(ctx.from?.id ?? "system", "group_unlinked", { chat_id: linked.chat_id, via: "replaced_by_new_group", new_chat_id: chatId });
  }
  await linkGroupIfUnset(chatId, title);
}

/** "Use the new group instead": unlink the current group and set up the new one as if the bot had just been promoted there. */
groupComposer.callbackQuery(/^gswitch\|(-?\d+)$/, async (ctx) => {
  if (!(await isAdminUser(ctx.from.id))) {
    await ctx.answerCallbackQuery({ text: "Admins only.", show_alert: true });
    return;
  }
  const chatId = Number(ctx.match[1]);
  let chat: { title?: string; is_forum?: boolean };
  try {
    chat = (await ctx.api.getChat(chatId)) as unknown as { title?: string; is_forum?: boolean };
  } catch (err) {
    await ctx.answerCallbackQuery({ text: `I can no longer reach that group: ${(err as Error).message}`.slice(0, 190), show_alert: true });
    return;
  }
  const linked = await getLinkedGroup();
  if (linked && linked.chat_id !== chatId) {
    await unlinkGroup(linked.chat_id);
    forgetChatMemo(linked.chat_id);
    await audit(ctx.from.id, "group_unlinked", { chat_id: linked.chat_id, via: "switched", new_chat_id: chatId });
  }
  forgetChatMemo(chatId);
  departed.delete(chatId);
  const title = chat.title ?? null;
  await linkGroupIfUnset(chatId, title);
  await upsertTopic({ chat_id: chatId, thread_id: 0, name: "General", chat_title: title });
  await ctx.answerCallbackQuery({ text: "Switched." });
  await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  const isAdminThere = await (async () => {
    try {
      const m = await ctx.api.getChatMember(chatId, ctx.me.id);
      return m.status === "administrator";
    } catch {
      return false;
    }
  })();
  if (!isAdminThere) {
    await ctx.reply(`✅ <b>${escapeHtml(title ?? String(chatId))}</b> is now the assembly group. Make me an administrator there to set up the topics and buttons.`, { parse_mode: "HTML" });
    return;
  }
  await onBotPromoted(ctx.api, chatId, title, Boolean(chat.is_forum));
  if (config.lockGroupPermissions) await lockGroupPermissions(ctx.api, chatId);
});

async function linkGroupIfUnset(chatId: number, title: string | null): Promise<void> {
  const memo = `${chatId}:group`;
  if (seen.has(memo)) return;
  const linked = await getLinkedGroup();
  if (!linked) {
    await setSetting("group", { chat_id: chatId, title });
    console.log(`Linked group "${title ?? chatId}" (${chatId})`);
  } else if (linked.chat_id === chatId && linked.title !== title) {
    await setSetting("group", { chat_id: chatId, title });
  }
  seen.add(memo);
}
