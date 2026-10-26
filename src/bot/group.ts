import { Composer } from "grammy";
import type { Context } from "grammy";
import { getLinkedGroup, setSetting, upsertTopic } from "../services/settings.js";

/**
 * Learns the assembly group and its forum topics from the updates the bot
 * sees (it is an admin of the group, so it sees every message). The Mini App
 * uses this list to let an admin pick where to announce a resolution, instead
 * of having to run /announce inside the topic.
 */
export const groupComposer = new Composer<Context>();

// Per-process memo so a busy group does not cause a database write per message.
const seen = new Set<string>();

groupComposer.use(async (ctx, next) => {
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
    if (status === "left" || status === "kicked") return;
    await linkGroupIfUnset(chat.id, title);
    await upsertTopic({ chat_id: chat.id, thread_id: 0, name: "General", chat_title: title });
    seen.add(`${chat.id}:0`);
    return;
  }

  const msg = ctx.message;
  if (!msg) return;
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
  }
}

async function linkGroupIfUnset(chatId: number, title: string | null): Promise<void> {
  const memo = `${chatId}:group`;
  if (seen.has(memo)) return;
  const linked = await getLinkedGroup();
  if (!linked) {
    await setSetting("group", { chat_id: chatId, title });
  } else if (linked.chat_id === chatId && linked.title !== title) {
    await setSetting("group", { chat_id: chatId, title });
  }
  seen.add(memo);
}
