import { Composer } from "grammy";
import type { Context } from "grammy";
import { audit } from "../db.js";
import { config } from "../config.js";
import { lockGroupPermissions } from "./group-lock.js";
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
      }
      forgetChatMemo(chat.id);
      return;
    }
    // Added or promoted: rare, so always re-read the stored link instead of trusting the memo.
    forgetChatMemo(chat.id);
    await linkGroupIfUnset(chat.id, title);
    await upsertTopic({ chat_id: chat.id, thread_id: 0, name: "General", chat_title: title });
    seen.add(`${chat.id}:0`);
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
