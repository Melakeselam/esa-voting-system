import { Bot, GrammyError, HttpError } from "grammy";
import { adminComposer } from "./admin.js";
import { groupComposer } from "./group.js";
import { memberComposer } from "./member.js";
import { config } from "../config.js";

export function createBot(): Bot {
  const bot = new Bot(config.botToken, config.telegramApiRoot ? { client: { apiRoot: config.telegramApiRoot } } : undefined);

  // Group/topic tracking first (always calls next), then admin commands, then
  // member handlers (order matters: the member text handler is a catch-all
  // for private chats).
  bot.use(groupComposer);
  bot.use(adminComposer);
  bot.use(memberComposer);

  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError) {
      console.error("Telegram API error:", e.description);
    } else if (e instanceof HttpError) {
      console.error("Network error contacting Telegram:", e);
    } else {
      console.error("Unhandled bot error:", e);
    }
  });

  return bot;
}
