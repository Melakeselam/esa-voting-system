import { Composer, InlineKeyboard, Keyboard } from "grammy";
import type { Api, Context } from "grammy";
import { findByTelegramId } from "../services/members.js";
import { getSetting, setSetting, upsertTopic } from "../services/settings.js";

/**
 * The bot's commands inside the assembly group. Anything personal (ballots,
 * status) is answered in the member's private chat, so a command typed in a
 * topic only gets a short bilingual pointer with a button that opens the
 * private chat at the right place. The same commands are offered three ways:
 *  - Telegram's "/" command menu, scoped to the group (English + Amharic);
 *  - a fixed reply keyboard with the four commands as buttons;
 *  - a pinned "📖 Commands" topic listing each command with a description —
 *    tapping a command in the text runs it.
 */
export const COMMANDS = [
  { command: "vote", en: "Show the resolutions open for voting and cast your ballot (in your private chat)", am: "ለድምፅ ክፍት የሆኑ የውሳኔ ሀሳቦችን ያሳያል፣ ድምፅዎን ይሰጣሉ (በግል ውይይትዎ)" },
  { command: "status", en: "Your registration and the ballots you have cast", am: "ምዝገባዎ እና የሰጡት ድምፆች" },
  { command: "register", en: "Register with your invitation code (first time only)", am: "በግብዣ ኮድዎ ይመዝገቡ (ለመጀመሪያ ጊዜ ብቻ)" },
  { command: "help", en: "How this bot works", am: "ይህ ቦት እንዴት እንደሚሠራ" },
] as const;

export const COMMANDS_TOPIC_NAME = "📖 Commands / ትዕዛዞች";

/** Fixed buttons under the message box: tapping one sends the command. */
export function commandKeyboard(): Keyboard {
  return new Keyboard().text("/vote").text("/status").row().text("/register").text("/help").resized().persistent();
}

/** The reference text pinned in the Commands topic, English then Amharic; the /commands in it are tappable. */
export function commandReference(): string {
  const en = COMMANDS.map((c) => `/${c.command} — ${c.en}`).join("\n");
  const am = COMMANDS.map((c) => `/${c.command} — ${c.am}`).join("\n");
  return (
    `📖 <b>Commands — ESA Voting System</b>\n` +
    `Tap a command to run it. Anything personal (your ballots, your status) is answered in your private chat with the bot, never here.\n\n${en}\n\n` +
    `📖 <b>ትዕዛዞች — የኢስኤ ድምፅ መስጫ ሥርዓት</b>\n` +
    `ለማስኬድ ትዕዛዙን ይንኩ። የግል የሆነ ማንኛውም ነገር (ድምፆችዎ፣ ሁኔታዎ) እዚህ ሳይሆን ከቦቱ ጋር ባለው የግል ውይይትዎ ውስጥ ይመለሳል።\n\n${am}`
  );
}

/** Put the four commands in the group's "/" menu, in English and in Amharic. */
export async function registerGroupCommands(api: Api, chatId: number): Promise<void> {
  const scope = { type: "chat" as const, chat_id: chatId };
  await api.setMyCommands(COMMANDS.map((c) => ({ command: c.command, description: c.en })), { scope });
  await api.setMyCommands(COMMANDS.map((c) => ({ command: c.command, description: c.am })), { scope, language_code: "am" });
}

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
 * Make sure the group has the "📖 Commands" topic with the reference pinned,
 * the command menu registered and the command buttons shown in General.
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

  if (saved?.message_id && !opts.repost && !created) {
    return { thread_id: threadId, message_id: saved.message_id, created: false, note: null };
  }

  let messageId: number | null = null;
  const post = async () => {
    const msg = await api.sendMessage(chatId, commandReference(), {
      parse_mode: "HTML",
      message_thread_id: threadId ?? undefined,
      reply_markup: commandKeyboard(),
    });
    messageId = msg.message_id;
  };
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
  if (messageId !== null) {
    try {
      await api.pinChatMessage(chatId, messageId, { disable_notification: true });
    } catch {
      notes.push("The command reference could not be pinned (the bot lacks the “Pin messages” right).");
    }
  }
  // The buttons live with the message they were sent with, so show them in the main chat too.
  if (threadId !== null) {
    try {
      await api.sendMessage(
        chatId,
        `📖 Command buttons are below the message box: /vote, /status, /register, /help. The “${COMMANDS_TOPIC_NAME}” topic explains each one.\n` +
          `📖 የትዕዛዝ አዝራሮች ከመልዕክት ሳጥኑ በታች ናቸው፦ /vote፣ /status፣ /register፣ /help። «${COMMANDS_TOPIC_NAME}» ርዕስ እያንዳንዱን ያብራራል።`,
        { reply_markup: commandKeyboard() },
      );
    } catch {
      // Not essential.
    }
  }
  await setSetting("commands_topic", { chat_id: chatId, thread_id: threadId, message_id: messageId } satisfies CommandsTopic);
  return { thread_id: threadId, message_id: messageId, created, note: notes.length ? notes.join(" ") : null };
}

// ---------------------------------------------------------------- commands typed in the group

export const groupCommandsComposer = new Composer<Context>();
const grp = groupCommandsComposer.chatType(["group", "supergroup"]);

function threadOf(ctx: Context): number | undefined {
  return ctx.msg?.is_topic_message ? ctx.msg.message_thread_id : undefined;
}

function privateButton(ctx: Context, label: string, start: string): InlineKeyboard {
  return new InlineKeyboard().url(label, `https://t.me/${ctx.me.username}?start=${start}`);
}

const VOTE_TEXT =
  "🗳 Ballots are cast in your private chat with the bot, so secret ballots stay secret. Tap below.\n" +
  "🗳 ድምፅ የሚሰጡት ከቦቱ ጋር ባለው የግል ውይይት ውስጥ ነው፤ ሚስጥራዊ ድምፆች ሚስጥር ሆነው ይቆያሉ። ከታች ይንኩ።";
const STATUS_TEXT =
  "📋 Your registration and ballots are shown to you privately. Tap below.\n" +
  "📋 ምዝገባዎ እና ድምፆችዎ ለእርስዎ በግል ይታያሉ። ከታች ይንኩ።";
const REGISTER_TEXT =
  "📝 You are not registered yet. Register in a private chat with the bot using your invitation code. Tap below.\n" +
  "📝 ገና አልተመዘገቡም። በግብዣ ኮድዎ ከቦቱ ጋር በግል ውይይት ይመዝገቡ። ከታች ይንኩ።";
const REGISTERED_TEXT =
  "✅ You are already registered. Use /vote when voting opens.\n" +
  "✅ አስቀድመው ተመዝግበዋል። ድምፅ መስጠት ሲከፈት /vote ይጠቀሙ።";

async function registered(ctx: Context): Promise<boolean> {
  const m = ctx.from ? await findByTelegramId(ctx.from.id) : null;
  return Boolean(m && m.is_active);
}

grp.command(["vote", "start"], async (ctx) => {
  const ok = await registered(ctx);
  await ctx.reply(ok ? VOTE_TEXT : REGISTER_TEXT, {
    parse_mode: "HTML",
    message_thread_id: threadOf(ctx),
    reply_markup: ok ? privateButton(ctx, "🗳 Open my ballots", "vote") : privateButton(ctx, "📝 Register first", "register"),
  });
});

grp.command("status", async (ctx) => {
  const ok = await registered(ctx);
  await ctx.reply(ok ? STATUS_TEXT : REGISTER_TEXT, {
    parse_mode: "HTML",
    message_thread_id: threadOf(ctx),
    reply_markup: ok ? privateButton(ctx, "📋 My status", "status") : privateButton(ctx, "📝 Register first", "register"),
  });
});

grp.command("register", async (ctx) => {
  const ok = await registered(ctx);
  await ctx.reply(ok ? REGISTERED_TEXT : REGISTER_TEXT, {
    parse_mode: "HTML",
    message_thread_id: threadOf(ctx),
    reply_markup: ok ? privateButton(ctx, "🗳 Open my ballots", "vote") : privateButton(ctx, "📝 Register with my code", "register"),
  });
});

grp.command("help", async (ctx) => {
  await ctx.reply(commandReference(), {
    parse_mode: "HTML",
    message_thread_id: threadOf(ctx),
    reply_markup: new InlineKeyboard()
      .url("🗳 My ballots", `https://t.me/${ctx.me.username}?start=vote`)
      .url("📝 Register", `https://t.me/${ctx.me.username}?start=register`),
  });
});
