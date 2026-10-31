import { Composer, InlineKeyboard } from "grammy";
import type { Api, Context } from "grammy";
import type { ChatMember, User } from "grammy/types";
import { audit } from "../db.js";
import { appUrl } from "../config.js";
import { isAdminUser } from "../services/admins.js";
import { findByTelegramId } from "../services/members.js";
import { getLinkedGroup, getSetting, setSetting, upsertTopic } from "../services/settings.js";
import { getGateMode, getPerson, listPeople, personName, seePerson, setPersonStatus } from "../services/group-people.js";
import { notifyAdmins } from "./notify.js";
import { COMMANDS_TOPIC_NAME, ensureCommandTopic } from "./group-commands.js";
import { appKeyboard, escapeHtml, signInCard, signInKeyboard } from "./ui.js";

/**
 * Guards the door of the assembly group. Only registered members (and admins)
 * belong there:
 *  - a join request from a registered member is approved at once; anyone else
 *    is told to register first and the admins are notified (the request stays
 *    pending so an admin can still approve it);
 *  - someone who joins or is added without being registered is reported to the
 *    admins, or removed straight away when the gate is set to "remove";
 *  - everyone seen in the group is recorded, so Setup can list who is not
 *    registered (Telegram gives bots no member list).
 * Needs the chat_member and chat_join_request update types and the bot's
 * "Ban users" right (for removals) and "Invite users" right (for approvals).
 */
export const gateComposer = new Composer<Context>();

const IN_GROUP = new Set(["member", "administrator", "creator"]);

function isIn(m: ChatMember): boolean {
  return IN_GROUP.has(m.status) || (m.status === "restricted" && m.is_member);
}

/** Registered, active member or an admin — someone who belongs in the group. */
export async function belongsInGroup(userId: number): Promise<boolean> {
  if (await isAdminUser(userId)) return true;
  const member = await findByTelegramId(userId);
  return Boolean(member && member.is_active);
}

function setupKeyboard(): InlineKeyboard | undefined {
  const url = appUrl();
  return url ? new InlineKeyboard().webApp("📋 Open Setup", url) : undefined;
}

async function tellUserToRegister(api: Api, userId: number, groupTitle: string, decided: "pending" | "removed"): Promise<void> {
  const head =
    decided === "removed"
      ? `You were removed from <b>${escapeHtml(groupTitle)}</b> because this account is not registered yet.`
      : `Your request to join <b>${escapeHtml(groupTitle)}</b> is waiting.`;
  try {
    await api.sendMessage(
      userId,
      `${head}\nRegister first with the invitation code you received from the National Office: send /start to this bot or open the app. ` +
        `Once registered you can join the group.`,
      { parse_mode: "HTML", reply_markup: appKeyboard("🗳 Open voting app") },
    );
  } catch {
    // The person has not opened the bot; Telegram allows a message only after a join request.
  }
}

/** Remove someone from the group without a lasting ban (ban + unban), so they can come back once registered. */
export async function kickFromGroup(api: Api, chatId: number, userId: number): Promise<void> {
  await api.banChatMember(chatId, userId);
  try {
    await api.unbanChatMember(chatId, userId, { only_if_banned: true });
  } catch {
    // Already lifted; nothing to do.
  }
  await setPersonStatus(chatId, userId, "kicked");
}

export async function approveJoin(api: Api, chatId: number, userId: number): Promise<void> {
  await api.approveChatJoinRequest(chatId, userId);
  await setPersonStatus(chatId, userId, "member");
}

export async function declineJoin(api: Api, chatId: number, userId: number): Promise<void> {
  await api.declineChatJoinRequest(chatId, userId);
  await setPersonStatus(chatId, userId, "left");
}

/** Called right after someone registers: let them in if they have a join request waiting. */
export async function approvePendingJoin(api: Api, userId: number): Promise<boolean> {
  try {
    const linked = await getLinkedGroup();
    if (!linked) return false;
    const person = await getPerson(linked.chat_id, userId);
    if (!person || person.status !== "pending") return false;
    await approveJoin(api, linked.chat_id, userId);
    await audit(userId, "join_request_approved", { chat_id: linked.chat_id, user_id: userId, via: "registration" });
    try {
      await api.sendMessage(userId, `✅ You are registered — your request to join <b>${escapeHtml(linked.title ?? "the assembly group")}</b> has been approved.`, { parse_mode: "HTML" });
    } catch {
      // Fine without the note.
    }
    return true;
  } catch (err) {
    console.error("approving a pending join request failed:", err);
    return false;
  }
}

// ---------------------------------------------------------------- sign-in topic

export const SIGNIN_TOPIC_NAME = "📝 Register / Sign in";

interface SignInTopic {
  chat_id: number;
  thread_id: number | null; // null = main chat (no topics)
  message_id: number | null;
}

export interface SignInResult {
  thread_id: number | null;
  message_id: number | null;
  created: boolean; // a new topic was created this time
  note: string | null; // what could not be done, for the admins
}

/**
 * Make sure the group has a "Register / Sign in" topic with the sign-in card
 * pinned in it. Creates the topic when it does not exist yet (forum groups,
 * needs the "Manage topics" right), falls back to the main chat otherwise.
 * With `repost`, posts the card again even if one was posted before.
 */
export async function ensureSignInTopic(
  api: Api,
  chatId: number,
  groupTitle: string | null,
  isForum: boolean,
  opts: { repost?: boolean } = {},
): Promise<SignInResult> {
  const me = await api.getMe();
  let saved = await getSetting<SignInTopic>("signin_topic");
  if (saved && saved.chat_id !== chatId) saved = null;
  let threadId = saved?.thread_id ?? null;
  let created = false;
  const notes: string[] = [];

  const createTopic = async (): Promise<boolean> => {
    try {
      const topic = await api.createForumTopic(chatId, SIGNIN_TOPIC_NAME);
      threadId = topic.message_thread_id;
      created = true;
      await upsertTopic({ chat_id: chatId, thread_id: threadId, name: SIGNIN_TOPIC_NAME, chat_title: groupTitle });
      return true;
    } catch (err) {
      notes.push(
        `Could not create the “${SIGNIN_TOPIC_NAME}” topic (${(err as Error).message}); the sign-in card went to the main chat instead. ` +
          `Give the bot the “Manage topics” right and tap “Post sign-in topic” in Setup.`,
      );
      threadId = null;
      return false;
    }
  };

  if (threadId === null && isForum) await createTopic();
  else if (!isForum) notes.push("The group has topics switched off, so the sign-in card was posted in the main chat.");

  if (saved?.message_id && !opts.repost && !created) {
    return { thread_id: threadId, message_id: saved.message_id, created: false, note: null };
  }

  let messageId: number | null = null;
  const post = async () => {
    const msg = await api.sendMessage(chatId, signInCard(groupTitle), {
      parse_mode: "HTML",
      message_thread_id: threadId ?? undefined,
      reply_markup: signInKeyboard(me.username),
    });
    messageId = msg.message_id;
  };
  try {
    await post();
  } catch (err) {
    // The remembered topic was deleted by hand: make a new one and try once more.
    if (isForum && /thread not found|TOPIC_DELETED|TOPIC_ID_INVALID/i.test((err as Error).message) && (await createTopic())) {
      try {
        await post();
      } catch (err2) {
        notes.push(`Could not post the sign-in card: ${(err2 as Error).message}`);
      }
    } else {
      notes.push(`Could not post the sign-in card: ${(err as Error).message}`);
    }
  }
  if (messageId !== null) {
    try {
      await api.pinChatMessage(chatId, messageId, { disable_notification: true });
    } catch {
      notes.push("The card could not be pinned (the bot lacks the “Pin messages” right).");
    }
  }
  await setSetting("signin_topic", { chat_id: chatId, thread_id: threadId, message_id: messageId } satisfies SignInTopic);
  return { thread_id: threadId, message_id: messageId, created, note: notes.length ? notes.join(" ") : null };
}

/**
 * The bot was just made admin of the assembly group: set up the sign-in topic
 * and tell the admins what the bot can and cannot see.
 */
export async function onBotPromoted(api: Api, chatId: number, groupTitle: string | null, isForum: boolean): Promise<void> {
  const title = groupTitle ?? "this group";
  let signin: SignInResult | null = null;
  try {
    signin = await ensureSignInTopic(api, chatId, groupTitle, isForum);
  } catch (err) {
    console.error("setting up the sign-in topic failed:", err);
  }
  let commandsNote: string | null = null;
  try {
    commandsNote = (await ensureCommandTopic(api, chatId, groupTitle, isForum)).note;
  } catch (err) {
    console.error("setting up the commands topic failed:", err);
  }
  const where =
    signin?.thread_id != null
      ? `A “${SIGNIN_TOPIC_NAME}” topic is ready with the sign-in card pinned in it: members tap “Register with your code” there and finish in their private chat with me. ` +
        `A “${COMMANDS_TOPIC_NAME}” topic lists the commands in English and Amharic, the “/” menu and the buttons under the message box offer the same.`
      : `The sign-in card and the command reference are posted in the main chat: members tap “Register with your code” and finish in their private chat with me.`;
  await notifyAdmins(
    api,
    `🛡 I am now an administrator of <b>${escapeHtml(title)}</b>.\n${escapeHtml(where)}` +
      (signin?.note ? `\n⚠️ ${escapeHtml(signin.note)}` : "") +
      (commandsNote ? `\n⚠️ ${escapeHtml(commandsNote)}` : "") +
      `\n\nTelegram does not let a bot list a group's members, so I cannot check the people already inside. ` +
      `They appear in Setup › “People in the group” as they post or join, marked when they are not registered; ` +
      `from there you can register them (choose their council and role) or remove them. New joiners are checked on entry.`,
    setupKeyboard(),
  );
}

// ---------------------------------------------------------------- updates

gateComposer.on("chat_member", async (ctx) => {
  const upd = ctx.chatMember;
  const linked = await getLinkedGroup();
  if (!linked || upd.chat.id !== linked.chat_id) return;
  const user: User = upd.new_chat_member.user;
  if (user.is_bot) return;
  const wasIn = isIn(upd.old_chat_member);
  const nowIn = isIn(upd.new_chat_member);
  const title = linked.title ?? ("title" in upd.chat ? upd.chat.title : null) ?? "the assembly group";

  if (nowIn && !wasIn) {
    const added = upd.from.id !== user.id;
    await seePerson({
      chat_id: upd.chat.id,
      user_id: user.id,
      first_name: user.first_name,
      last_name: user.last_name ?? null,
      username: user.username ?? null,
      status: "member",
      source: added ? "added" : "joined",
      added_by: added ? upd.from.id : null,
    });
    if (await belongsInGroup(user.id)) return;

    const who = `👤 <b>${escapeHtml(personName({ ...user, last_name: user.last_name ?? null, username: user.username ?? null, user_id: user.id }))}</b>` +
      (user.username ? ` (@${escapeHtml(user.username)})` : "") + ` · ID <code>${user.id}</code>`;
    const how = added ? `was added by <b>${escapeHtml(upd.from.first_name)}</b> to` : "joined";
    const mode = await getGateMode();
    if (mode === "remove") {
      try {
        await kickFromGroup(ctx.api, upd.chat.id, user.id);
        await audit(upd.from.id, "group_member_removed", { chat_id: upd.chat.id, user_id: user.id, via: "gate_auto" });
        await tellUserToRegister(ctx.api, user.id, title, "removed");
        await notifyAdmins(ctx.api, `${who} ${how} <b>${escapeHtml(title)}</b> without being registered and was removed automatically.`, setupKeyboard());
      } catch (err) {
        console.error("automatic removal failed:", err);
        await notifyAdmins(ctx.api, `${who} ${how} <b>${escapeHtml(title)}</b> without being registered. I could not remove them: ${escapeHtml((err as Error).message)}. Give me the “Ban users” right or remove them by hand.`, setupKeyboard());
      }
      return;
    }
    const kb = new InlineKeyboard().text("🚫 Remove from group", `gate|rm|${upd.chat.id}|${user.id}`);
    const url = appUrl();
    if (url) kb.row().webApp("📋 Register in Setup", url);
    await notifyAdmins(ctx.api, `${who} ${how} <b>${escapeHtml(title)}</b> but is <b>not registered</b>. Register them in Setup or remove them.`, kb);
    return;
  }

  if (wasIn && !nowIn) {
    const status = upd.new_chat_member.status === "kicked" ? "kicked" : "left";
    await seePerson({ chat_id: upd.chat.id, user_id: user.id, status });
  }
});

gateComposer.on("chat_join_request", async (ctx) => {
  const req = ctx.chatJoinRequest;
  const linked = await getLinkedGroup();
  if (!linked || req.chat.id !== linked.chat_id) return;
  const user = req.from;
  const title = linked.title ?? ("title" in req.chat ? req.chat.title : null) ?? "the assembly group";
  await seePerson({
    chat_id: req.chat.id,
    user_id: user.id,
    first_name: user.first_name,
    last_name: user.last_name ?? null,
    username: user.username ?? null,
    status: "pending",
    source: "join_request",
  });
  if (await belongsInGroup(user.id)) {
    try {
      await approveJoin(ctx.api, req.chat.id, user.id);
      await audit(user.id, "join_request_approved", { chat_id: req.chat.id, user_id: user.id, via: "registered" });
    } catch (err) {
      console.error("approving a registered member's join request failed:", err);
    }
    return;
  }
  await tellUserToRegister(ctx.api, user.id, title, "pending");
  const kb = new InlineKeyboard()
    .text("✅ Approve", `gate|ok|${req.chat.id}|${user.id}`)
    .text("❌ Decline", `gate|no|${req.chat.id}|${user.id}`);
  const url = appUrl();
  if (url) kb.row().webApp("📋 Register in Setup", url);
  await notifyAdmins(
    ctx.api,
    `🚪 <b>${escapeHtml(personName({ ...user, last_name: user.last_name ?? null, username: user.username ?? null, user_id: user.id }))}</b>` +
      (user.username ? ` (@${escapeHtml(user.username)})` : "") +
      ` · ID <code>${user.id}</code> asks to join <b>${escapeHtml(title)}</b> but is <b>not registered</b>. ` +
      `They were told to register first; the request is approved automatically once they do.`,
    kb,
  );
});

// Anyone who posts in the linked group is a person the bot has seen.
const postersSeen = new Set<string>();
gateComposer.on("message", async (ctx, next) => {
  const chat = ctx.chat;
  const user = ctx.from;
  if (user && !user.is_bot && (chat.type === "supergroup" || chat.type === "group")) {
    const key = `${chat.id}:${user.id}`;
    if (!postersSeen.has(key)) {
      const linked = await getLinkedGroup();
      if (linked?.chat_id === chat.id) {
        postersSeen.add(key);
        try {
          await seePerson({
            chat_id: chat.id,
            user_id: user.id,
            first_name: user.first_name,
            last_name: user.last_name ?? null,
            username: user.username ?? null,
            status: "member",
            source: "posted",
          });
        } catch (err) {
          console.error("recording a group poster failed:", err);
        }
      }
    }
  }
  await next();
});

// Buttons under the admin notifications.
gateComposer.callbackQuery(/^gate\|(rm|ok|no)\|(-?\d+)\|(\d+)$/, async (ctx) => {
  const [, action, chatStr, userStr] = ctx.match;
  const chatId = Number(chatStr);
  const userId = Number(userStr);
  if (!(await isAdminUser(ctx.from.id))) {
    await ctx.answerCallbackQuery({ text: "Admins only.", show_alert: true });
    return;
  }
  try {
    if (action === "rm") {
      await kickFromGroup(ctx.api, chatId, userId);
      await audit(ctx.from.id, "group_member_removed", { chat_id: chatId, user_id: userId, via: "button" });
      await ctx.answerCallbackQuery({ text: "Removed from the group." });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      await ctx.reply(`🚫 Removed ID <code>${userId}</code> from the group.`, { parse_mode: "HTML" });
    } else if (action === "ok") {
      await approveJoin(ctx.api, chatId, userId);
      await audit(ctx.from.id, "join_request_approved", { chat_id: chatId, user_id: userId, via: "button" });
      await ctx.answerCallbackQuery({ text: "Approved." });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      await ctx.reply(`✅ Approved the join request of ID <code>${userId}</code>. They are still not registered — register them in Setup so they can vote.`, { parse_mode: "HTML" });
    } else {
      await declineJoin(ctx.api, chatId, userId);
      await audit(ctx.from.id, "join_request_declined", { chat_id: chatId, user_id: userId, via: "button" });
      await ctx.answerCallbackQuery({ text: "Declined." });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    }
  } catch (err) {
    await ctx.answerCallbackQuery({ text: `Telegram refused: ${(err as Error).message}`.slice(0, 190), show_alert: true });
  }
});

/** People in the linked group who are not registered members or admins — for Setup. */
export async function unregisteredPeople(chatId: number, botId: number): Promise<{ seen: number; registered: number; unregistered: Awaited<ReturnType<typeof listPeople>> }> {
  const people = (await listPeople(chatId)).filter((p) => p.user_id !== botId && (p.status === "member" || p.status === "pending"));
  const unregistered = [];
  for (const p of people) if (!(await belongsInGroup(p.user_id))) unregistered.push(p);
  return { seen: people.length, registered: people.length - unregistered.length, unregistered };
}
