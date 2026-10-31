import { Bot, GrammyError, HttpError } from "grammy";
import { adminComposer } from "./admin.js";
import { groupComposer } from "./group.js";
import { gateComposer } from "./gate.js";
import { groupCommandsComposer } from "./group-commands.js";
import { resetComposer } from "./reset-flow.js";
import { quorumComposer } from "./quorum-flow.js";
import { memberComposer } from "./member.js";
import { config } from "../config.js";

export function createBot(): Bot {
  // 30 s per API call instead of grammY's 500 s default: a hung call must fail
  // fast rather than stall the handler (and the webhook queue behind it).
  const bot = new Bot(config.botToken, {
    client: { ...(config.telegramApiRoot ? { apiRoot: config.telegramApiRoot } : {}), timeoutSeconds: 30 },
  });

  // Egress from the hosting cluster to Telegram has been seen to take minutes;
  // log the slow calls so the logs show it when replies or group updates lag.
  bot.api.config.use(async (prev, method, payload, signal) => {
    const t0 = Date.now();
    try {
      return await prev(method, payload, signal);
    } finally {
      const ms = Date.now() - t0;
      if (ms >= 5_000) console.warn(`Telegram API ${method} took ${(ms / 1000).toFixed(1)} s`);
    }
  });

  // Group/topic tracking first (always calls next), then admin commands, then
  // member handlers (order matters: the member text handler is a catch-all
  // for private chats).
  bot.use(groupComposer);
  bot.use(gateComposer);
  bot.use(groupCommandsComposer);
  bot.use(resetComposer);
  bot.use(quorumComposer);
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
