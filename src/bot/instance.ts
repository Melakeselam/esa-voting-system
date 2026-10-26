import type { Bot } from "grammy";
import { createBot } from "./index.js";

/**
 * Single bot instance shared by the HTTP layer and the server entry point.
 * In serverless mode the module (and this instance) is reused across warm
 * invocations, so bot.init() runs at most once per instance.
 */
export const bot: Bot = createBot();

let initPromise: Promise<void> | null = null;

export async function ensureBotReady(): Promise<Bot> {
  if (!bot.isInited()) {
    initPromise ??= bot.init().catch((err) => {
      initPromise = null;
      throw err;
    });
    await initPromise;
  }
  return bot;
}
