import { Composer, InlineKeyboard, Keyboard } from "grammy";
import type { Api, Context } from "grammy";
import { audit } from "../db.js";
import { config } from "../config.js";
import { findByTelegramId } from "../services/members.js";
import { deleteSetting, getSetting, getTopic, listTopics, setSetting, updateTopic, upsertTopic, type GroupMemory } from "../services/settings.js";
import { orgWords, type OrgWords } from "../services/orgs.js";
import { getLang, inLang, isSignedIn, setLang, setPresence, type Lang } from "../services/presence.js";
import { ensureLiveBoard } from "./live-board.js";
import { escapeHtml } from "./ui.js";

/**
 * The bot's commands inside the assembly group. Anything personal (ballots,
 * status) is answered in the member's private chat, so a command typed in a
 * topic only gets a short pointer with a button that opens the private chat
 * (or the Mini App) at the right place; the tap and the answer are removed
 * after a minute so the topics stay readable. The same commands are offered:
 *  - in Telegram's "/" command menu, scoped to the group (English + Amharic);
 *  - as buttons under the message box, in every topic members can post in;
 *  - as a pinned button panel in read-only topics (where members cannot post,
 *    so the message-box buttons cannot work) — the panel's buttons answer
 *    privately (a pop-up or a link), never in the topic;
 *  - in a pinned "📖 Commands" topic listing each command with a description.
 */
export const COMMANDS = [
  { command: "vote", en: "Show the resolutions open for voting and cast your ballot (in your private chat)", am: "ለድምፅ ክፍት የሆኑ የውሳኔ ሀሳቦችን ያሳያል፣ ድምፅዎን ይሰጣሉ (በግል ውይይትዎ)" },
  { command: "status", en: "Your registration and the ballots you have cast", am: "ምዝገባዎ እና የሰጡት ድምፆች" },
  { command: "signin", en: "Sign in to the session (you count as present and can vote)", am: "ወደ ስብሰባው ይግቡ (እንደተገኙ ይቆጠራሉ፣ ድምፅ መስጠት ይችላሉ)" },
  { command: "logout", en: "Sign out of the session (you no longer count as present)", am: "ከስብሰባው ይውጡ (እንደተገኙ አይቆጠሩም)" },
  { command: "language", en: "Choose English or Amharic for the bot and the app", am: "ለቦቱ እና ለመተግበሪያው እንግሊዝኛ ወይም አማርኛ ይምረጡ" },
  { command: "register", en: "Register with your invitation code (first time only)", am: "በግብዣ ኮድዎ ይመዝገቡ (ለመጀመሪያ ጊዜ ብቻ)" },
  { command: "help", en: "How this bot works", am: "ይህ ቦት እንዴት እንደሚሠራ" },
] as const;
type CommandName = (typeof COMMANDS)[number]["command"] | "bot";

export const COMMANDS_TOPIC_NAME = "📖 Commands / ትዕዛዞች";

/**
 * The buttons under the message box, two rows of three. Every member sees the
 * same buttons (Telegram has no per-person buttons in a group), so registering
 * is not among them: it lives in the "Register / Sign in" topic, and Vote
 * points anyone not registered there.
 */
const KEYBOARD: { label: string; command: CommandName }[][] = [
  [
    { label: "🗳 Vote", command: "vote" },
    { label: "📋 Status", command: "status" },
    { label: "🌐 Language", command: "language" },
  ],
  [
    { label: "🤖 Bot", command: "bot" },
    { label: "🚪 Logout", command: "logout" },
    { label: "❔ Help", command: "help" },
  ],
];

export function commandKeyboard(): Keyboard {
  const kb = new Keyboard();
  KEYBOARD.forEach((row, i) => {
    if (i > 0) kb.row();
    for (const b of row) kb.text(b.label);
  });
  return kb.resized().persistent();
}

// Buttons of earlier keyboards still answer, until every topic has the new row.
const LABEL_TO_COMMAND = new Map<string, CommandName>([
  ...KEYBOARD.flat().map((b): [string, CommandName] => [b.label, b.command]),
  ["📝 Register", "register"],
]);

/** Where a button opens: the Mini App when it has a short name, else the private chat. */
function openLink(botUsername: string, start: string): string {
  return config.miniAppShortName
    ? `https://t.me/${botUsername}/${config.miniAppShortName}?startapp=${start}`
    : `https://t.me/${botUsername}?start=${start}`;
}

/**
 * The pinned panel of a read-only topic (and the buttons of the Commands
 * card). Links open the app or the private chat; the rest answer with a
 * pop-up only the tapper sees.
 */
export function panelKeyboard(botUsername: string): InlineKeyboard {
  return new InlineKeyboard()
    .url("🗳 Vote", openLink(botUsername, "vote"))
    .url("📋 Status", openLink(botUsername, "status"))
    .row()
    .text("🙋 Sign in", "pr|in")
    .text("🚪 Logout", "pr|out")
    .row()
    .text("🇬🇧 English", "lang|en")
    .text("🇪🇹 አማርኛ", "lang|am")
    .url("🤖 Bot", `https://t.me/${botUsername}`);
}

/** The reference text pinned in the Commands topic, English then Amharic; the /commands in it are tappable. */
export function commandReference(w: OrgWords): string {
  const en = COMMANDS.map((c) => `/${c.command} — ${c.en}`).join("\n");
  const am = COMMANDS.map((c) => `/${c.command} — ${c.am}`).join("\n");
  return (
    `📖 <b>Commands — ${escapeHtml(w.branded)}</b>\n` +
    `Tap a command or a button. Anything personal (your ballots, your status) is answered in your private chat with the bot, never here.\n\n${en}\n\n` +
    `📖 <b>ትዕዛዞች — ${escapeHtml(w.nameAm ? `${w.nameAm} (Kene Voting System)` : w.branded)}</b>\n` +
    `ትዕዛዙን ወይም አዝራሩን ይንኩ። የግል የሆነ ማንኛውም ነገር (ድምፆችዎ፣ ሁኔታዎ) እዚህ ሳይሆን ከቦቱ ጋር ባለው የግል ውይይትዎ ውስጥ ይመለሳል።\n\n${am}`
  );
}

/** Put the commands in the group's "/" menu, in English and in Amharic. */
export async function registerGroupCommands(api: Api, chatId: number): Promise<void> {
  const scope = { type: "chat" as const, chat_id: chatId };
  await api.setMyCommands(COMMANDS.map((c) => ({ command: c.command, description: c.en.slice(0, 256) })), { scope });
  await api.setMyCommands(COMMANDS.map((c) => ({ command: c.command, description: c.am.slice(0, 256) })), { scope, language_code: "am" });
}

// ---------------------------------------------------------------- buttons in every topic

const NOT_MODIFIED = /TOPIC_NOT_MODIFIED|not modified/i;

async function deleteQuietly(api: Api, chatId: number, messageId: number | null | undefined): Promise<void> {
  if (!messageId) return;
  try {
    await api.deleteMessage(chatId, messageId);
  } catch {
    // Already gone, or older than Telegram lets a bot delete.
  }
}

/**
 * Show the buttons under the message box in one topic (0 = General): post a
 * "⌨️" carrying them and remove the one posted before, so each topic holds a
 * single keyboard message.
 */
export async function postKeyboard(api: Api, chatId: number, threadId: number, title: string | null = null): Promise<void> {
  let topic = await getTopic(chatId, threadId);
  if (!topic) {
    await upsertTopic({ chat_id: chatId, thread_id: threadId, chat_title: title });
    topic = await getTopic(chatId, threadId);
  }
  if (topic?.read_only) return;
  const msg = await api.sendMessage(chatId, "⌨️", {
    message_thread_id: threadId || undefined,
    reply_markup: commandKeyboard(),
    disable_notification: true,
  });
  await deleteQuietly(api, chatId, topic?.keyboard_message_id);
  await updateTopic(chatId, threadId, { keyboard_message_id: msg.message_id });
}

/**
 * The bot is back in a group it was removed from: take its old button
 * messages away (they would be duplicates of the ones about to be posted) and
 * close again the topics that were read-only.
 */
async function restoreFromMemory(api: Api, chatId: number, title: string | null): Promise<void> {
  const memory = await getSetting<GroupMemory>("group_memory");
  if (!memory || Number(memory.chat_id) !== chatId) return;
  for (const t of memory.topics) {
    await deleteQuietly(api, chatId, t.keyboard_message_id);
    const threadId = Number(t.thread_id);
    if (t.read_only && threadId !== 0) {
      await upsertTopic({ chat_id: chatId, thread_id: threadId, chat_title: title });
      await updateTopic(chatId, threadId, { read_only: true, panel_message_id: t.panel_message_id ?? null });
      await api.closeForumTopic(chatId, threadId).catch(() => undefined);
    } else {
      await deleteQuietly(api, chatId, t.panel_message_id);
    }
  }
  await deleteSetting("group_memory");
}

/** The buttons in General and every topic members can post in. Returns the topics it could not reach. */
export async function postKeyboards(api: Api, chatId: number, title: string | null): Promise<string[]> {
  await restoreFromMemory(api, chatId, title);
  const failed: string[] = [];
  const topics = (await listTopics()).filter((t) => Number(t.chat_id) === chatId && !t.read_only);
  // Topics members post in that the bot knew before it was removed get their buttons back too.
  if (!topics.some((t) => Number(t.thread_id) === 0)) topics.unshift({ chat_id: chatId, thread_id: 0, name: "General", chat_title: title, updated_at: "" });
  for (const t of topics) {
    try {
      await postKeyboard(api, chatId, Number(t.thread_id), title);
    } catch (err) {
      failed.push(`${t.name ?? `#${t.thread_id}`} (${(err as Error).message})`);
    }
  }
  return failed;
}

/**
 * Make a topic read-only (only admins post; Telegram "closes" it) or open it
 * again. A read-only topic loses the message-box buttons — members cannot send
 * there, so the buttons could not work — and gets a pinned button panel
 * instead (unless `panel` is false: the Commands and sign-in cards carry the
 * buttons themselves).
 */
export async function setTopicReadOnly(
  api: Api,
  chatId: number,
  threadId: number,
  on: boolean,
  opts: { panel?: boolean; title?: string | null; name?: string | null } = {},
): Promise<void> {
  if (threadId === 0) throw new Error("General cannot be made read-only.");
  let topic = await getTopic(chatId, threadId);
  if (!topic) {
    await upsertTopic({ chat_id: chatId, thread_id: threadId, name: opts.name ?? null, chat_title: opts.title ?? null });
    topic = await getTopic(chatId, threadId);
  }
  if (on) {
    try {
      await api.closeForumTopic(chatId, threadId);
    } catch (err) {
      if (!NOT_MODIFIED.test((err as Error).message)) throw err;
    }
    await deleteQuietly(api, chatId, topic?.keyboard_message_id);
    let panelId = topic?.panel_message_id ?? null;
    if (opts.panel !== false && !panelId) {
      const me = await api.getMe();
      const msg = await api.sendMessage(
        chatId,
        "⌨️ <b>Quick actions</b> — only admins post in this topic; use these buttons.\n⌨️ <b>ፈጣን እርምጃዎች</b> — በዚህ ርዕስ የሚጽፉት አስተዳዳሪዎች ብቻ ናቸው፤ እነዚህን አዝራሮች ይጠቀሙ።",
        { parse_mode: "HTML", message_thread_id: threadId, reply_markup: panelKeyboard(me.username), disable_notification: true },
      );
      panelId = msg.message_id;
      try {
        await api.pinChatMessage(chatId, panelId, { disable_notification: true });
      } catch {
        // Fine unpinned.
      }
    }
    await updateTopic(chatId, threadId, { read_only: true, keyboard_message_id: null, panel_message_id: panelId });
  } else {
    try {
      await api.reopenForumTopic(chatId, threadId);
    } catch (err) {
      if (!NOT_MODIFIED.test((err as Error).message)) throw err;
    }
    await deleteQuietly(api, chatId, topic?.panel_message_id);
    await updateTopic(chatId, threadId, { read_only: false, panel_message_id: null });
    await postKeyboard(api, chatId, threadId, opts.title ?? null);
  }
}

// ---------------------------------------------------------------- the Commands topic

interface CommandsTopic {
  chat_id: number;
  thread_id: number | null;
  message_id: number | null;
}

export interface CommandsResult {
  thread_id: number | null;
  message_id: number | null;
  created: boolean;
  note: string | null;
}

/**
 * Make sure the group has the read-only "📖 Commands" topic with the
 * reference pinned, the command menu registered, the buttons shown in every
 * topic members post in, and the live board pinned in General.
 */
export async function ensureCommandTopic(
  api: Api,
  chatId: number,
  groupTitle: string | null,
  isForum: boolean,
  opts: { repost?: boolean } = {},
): Promise<CommandsResult> {
  const notes: string[] = [];
  try {
    await registerGroupCommands(api, chatId);
  } catch (err) {
    notes.push(`Could not register the command menu: ${(err as Error).message}.`);
  }

  let saved = await getSetting<CommandsTopic>("commands_topic");
  if (saved && saved.chat_id !== chatId) saved = null;
  let threadId = saved?.thread_id ?? null;
  let created = false;

  const createTopic = async (): Promise<boolean> => {
    try {
      const topic = await api.createForumTopic(chatId, COMMANDS_TOPIC_NAME);
      threadId = topic.message_thread_id;
      created = true;
      await upsertTopic({ chat_id: chatId, thread_id: threadId, name: COMMANDS_TOPIC_NAME, chat_title: groupTitle });
      return true;
    } catch (err) {
      notes.push(`Could not create the “${COMMANDS_TOPIC_NAME}” topic (${(err as Error).message}); the reference went to the main chat.`);
      threadId = null;
      return false;
    }
  };
  if (threadId === null && isForum) await createTopic();

  // Already posted (the bot is back in a group it knew): keep the pinned
  // reference, but set up everything around it again below.
  const keep = Boolean(saved?.message_id && !opts.repost && !created);

  const me = await api.getMe();
  let messageId: number | null = keep ? saved!.message_id : null;
  const post = async () => {
    const msg = await api.sendMessage(chatId, commandReference(await orgWords()), {
      parse_mode: "HTML",
      message_thread_id: threadId ?? undefined,
      reply_markup: panelKeyboard(me.username),
    });
    messageId = msg.message_id;
  };
  if (!keep) {
    try {
      await post();
    } catch (err) {
      if (isForum && /thread not found|TOPIC_DELETED|TOPIC_ID_INVALID/i.test((err as Error).message) && (await createTopic())) {
        try {
          await post();
        } catch (err2) {
          notes.push(`Could not post the command reference: ${(err2 as Error).message}`);
        }
      } else {
        notes.push(`Could not post the command reference: ${(err as Error).message}`);
      }
    }
  }
  if (messageId !== null && !keep) {
    if (saved?.message_id && saved.message_id !== messageId) await deleteQuietly(api, chatId, saved.message_id);
    try {
      await api.pinChatMessage(chatId, messageId, { disable_notification: true });
    } catch {
      notes.push("The command reference could not be pinned (the bot lacks the “Pin messages” right).");
    }
  }
  await setSetting("commands_topic", { chat_id: chatId, thread_id: threadId, message_id: messageId } satisfies CommandsTopic);

  if (threadId !== null) {
    if (keep) await upsertTopic({ chat_id: chatId, thread_id: threadId, name: COMMANDS_TOPIC_NAME, chat_title: groupTitle });
    try {
      await setTopicReadOnly(api, chatId, threadId, true, { panel: false, title: groupTitle, name: COMMANDS_TOPIC_NAME });
    } catch (err) {
      notes.push(`Could not make the Commands topic read-only (${(err as Error).message}); give the bot the “Manage topics” right.`);
    }
  }
  const failed = await postKeyboards(api, chatId, groupTitle);
  if (failed.length) notes.push(`The buttons could not be shown in: ${failed.join(", ")}.`);
  try {
    await ensureLiveBoard(api, chatId, { repost: opts.repost });
  } catch (err) {
    notes.push(`Could not post the live board: ${(err as Error).message}`);
  }
  return { thread_id: threadId, message_id: messageId, created, note: notes.length ? notes.join(" ") : null };
}

// ---------------------------------------------------------------- commands typed in the group

export const groupCommandsComposer = new Composer<Context>();
const grp = groupCommandsComposer.chatType(["group", "supergroup"]);

const ANSWER_TTL_MS = 60_000;

function threadOf(ctx: Context): number | undefined {
  return ctx.msg?.is_topic_message ? ctx.msg.message_thread_id : undefined;
}

/**
 * Answer a command or button in the topic it came from, then tidy up: the
 * member's tap goes at once, the answer after a minute — long enough to tap
 * its button. Needs the bot's "Delete messages" right; without it both stay.
 */
async function answer(ctx: Context, text: string, keyboard?: InlineKeyboard): Promise<void> {
  const chatId = ctx.chat!.id;
  if (ctx.msg) await deleteQuietly(ctx.api, chatId, ctx.msg.message_id);
  const sent = await ctx.api.sendMessage(chatId, text, {
    parse_mode: "HTML",
    message_thread_id: threadOf(ctx),
    reply_markup: keyboard,
    disable_notification: true,
  });
  const timer = setTimeout(() => void deleteQuietly(ctx.api, chatId, sent.message_id), ANSWER_TTL_MS);
  timer.unref?.();
}

const T = {
  vote: ["🗳 Ballots are cast in your private chat with the bot, so secret ballots stay secret. Tap below.", "🗳 ድምፅ የሚሰጡት ከቦቱ ጋር ባለው የግል ውይይት ውስጥ ነው፤ ሚስጥራዊ ድምፆች ሚስጥር ሆነው ይቆያሉ። ከታች ይንኩ።"],
  status: ["📋 Your registration and ballots are shown to you privately. Tap below.", "📋 ምዝገባዎ እና ድምፆችዎ ለእርስዎ በግል ይታያሉ። ከታች ይንኩ።"],
  register: ["📝 You are not registered yet. Register in a private chat with the bot using your invitation code. Tap below.", "📝 ገና አልተመዘገቡም። በግብዣ ኮድዎ ከቦቱ ጋር በግል ውይይት ይመዝገቡ። ከታች ይንኩ።"],
  registered: ["✅ You are already registered.", "✅ አስቀድመው ተመዝግበዋል።"],
  signedOut: ["🚪 You are signed out of the session, so you cannot vote. Sign in first.", "🚪 ከስብሰባው ወጥተዋል፤ ድምፅ መስጠት አይችሉም። መጀመሪያ ይግቡ።"],
  signedIn: ["🙋 You are signed in to the session.", "🙋 ወደ ስብሰባው ገብተዋል።"],
  loggedOut: ["🚪 You are signed out: you no longer count as present and cannot vote until you sign in again. Your registration is kept.", "🚪 ከስብሰባው ወጥተዋል፤ እንደተገኙ አይቆጠሩም፣ እንደገና እስኪገቡ ድረስ ድምፅ መስጠት አይችሉም። ምዝገባዎ ይቀመጣል።"],
  language: ["🌐 Choose your language for the bot and the app.", "🌐 ለቦቱ እና ለመተግበሪያው ቋንቋዎን ይምረጡ።"],
  bot: ["🤖 Your private chat with the bot: ballots, results and your status.", "🤖 ከቦቱ ጋር ያለዎት የግል ውይይት፦ ድምፆች፣ ውጤቶች እና ሁኔታዎ።"],
} as const;

async function say(ctx: Context, key: keyof typeof T): Promise<string> {
  const lang = ctx.from ? await getLang(ctx.from.id) : null;
  return inLang(lang, T[key][0], T[key][1]);
}

async function memberOf(ctx: Context) {
  const m = ctx.from ? await findByTelegramId(ctx.from.id) : null;
  return m && m.is_active ? m : null;
}

function registerButton(ctx: Context): InlineKeyboard {
  return new InlineKeyboard().url("📝 Register with my code", openLink(ctx.me.username, "register"));
}

function signInButton(): InlineKeyboard {
  return new InlineKeyboard().text("🙋 Sign in", "pr|in");
}

async function answerVote(ctx: Context): Promise<void> {
  const m = await memberOf(ctx);
  if (!m) return answer(ctx, await say(ctx, "register"), registerButton(ctx));
  if (!isSignedIn(m)) return answer(ctx, await say(ctx, "signedOut"), signInButton());
  await answer(ctx, await say(ctx, "vote"), new InlineKeyboard().url("🗳 Open my ballots", openLink(ctx.me.username, "vote")));
}

async function answerStatus(ctx: Context): Promise<void> {
  const m = await memberOf(ctx);
  if (!m) return answer(ctx, await say(ctx, "register"), registerButton(ctx));
  await answer(ctx, await say(ctx, "status"), new InlineKeyboard().url("📋 My status", openLink(ctx.me.username, "status")));
}

async function answerRegister(ctx: Context): Promise<void> {
  const m = await memberOf(ctx);
  if (m) return answer(ctx, await say(ctx, "registered"), new InlineKeyboard().url("🗳 Open my ballots", openLink(ctx.me.username, "vote")));
  await answer(ctx, await say(ctx, "register"), registerButton(ctx));
}

async function answerSignIn(ctx: Context): Promise<void> {
  const m = await memberOf(ctx);
  if (!m) return answer(ctx, await say(ctx, "register"), registerButton(ctx));
  if (!isSignedIn(m)) {
    await setPresence(m.id, "available");
    await audit(ctx.from!.id, "signed_in", { via: "group" });
  }
  await answer(ctx, await say(ctx, "signedIn"));
}

async function answerLogout(ctx: Context): Promise<void> {
  const m = await memberOf(ctx);
  if (!m) return answer(ctx, await say(ctx, "register"), registerButton(ctx));
  if (isSignedIn(m)) {
    await setPresence(m.id, "out");
    await audit(ctx.from!.id, "signed_out", { via: "group" });
  }
  await answer(ctx, await say(ctx, "loggedOut"), signInButton());
}

async function answerLanguage(ctx: Context): Promise<void> {
  await answer(
    ctx,
    await say(ctx, "language"),
    new InlineKeyboard().text("🇬🇧 English", "lang|en").text("🇪🇹 አማርኛ", "lang|am").text("🇬🇧+🇪🇹 Both / ሁለቱም", "lang|both"),
  );
}

async function answerBot(ctx: Context): Promise<void> {
  await answer(ctx, await say(ctx, "bot"), new InlineKeyboard().url("🤖 Open the bot", `https://t.me/${ctx.me.username}`));
}

async function answerHelp(ctx: Context): Promise<void> {
  await answer(ctx, commandReference(await orgWords()), panelKeyboard(ctx.me.username));
}

const ANSWERS: Record<CommandName, (ctx: Context) => Promise<void>> = {
  vote: answerVote,
  status: answerStatus,
  register: answerRegister,
  signin: answerSignIn,
  logout: answerLogout,
  language: answerLanguage,
  bot: answerBot,
  help: answerHelp,
};

grp.command(["vote", "start"], answerVote);
grp.command("status", answerStatus);
grp.command("register", answerRegister);
grp.command("signin", answerSignIn);
grp.command("logout", answerLogout);
grp.command("language", answerLanguage);
grp.command("help", answerHelp);

// The buttons under the message box send their label as plain text.
grp.on("message:text", async (ctx, next) => {
  const command = LABEL_TO_COMMAND.get(ctx.message.text.trim());
  if (!command) return next();
  await ANSWERS[command](ctx);
});

// ---------------------------------------------------------------- panel buttons (any chat; answered with a pop-up)

groupCommandsComposer.callbackQuery(/^pr\|(in|out)$/, async (ctx) => {
  const lang = await getLang(ctx.from.id);
  const m = await findByTelegramId(ctx.from.id);
  if (!m || !m.is_active) {
    await ctx.answerCallbackQuery({ text: inLang(lang, T.register[0], T.register[1]).slice(0, 200), show_alert: true });
    return;
  }
  const signIn = ctx.match[1] === "in";
  if (isSignedIn(m) !== signIn) {
    await setPresence(m.id, signIn ? "available" : "out");
    await audit(ctx.from.id, signIn ? "signed_in" : "signed_out", { via: "panel" });
  }
  const key = signIn ? "signedIn" : "loggedOut";
  await ctx.answerCallbackQuery({ text: inLang(lang, T[key][0], T[key][1]).slice(0, 200), show_alert: !signIn });
});

groupCommandsComposer.callbackQuery(/^lang\|(en|am|both)$/, async (ctx) => {
  const choice = ctx.match[1];
  const lang: Lang | null = choice === "both" ? null : (choice as Lang);
  await setLang(ctx.from.id, lang);
  await ctx.answerCallbackQuery({
    text: lang === "en" ? "🌐 English it is." : lang === "am" ? "🌐 አማርኛ ተመርጧል።" : "🌐 English and Amharic / እንግሊዝኛ እና አማርኛ",
  });
});
