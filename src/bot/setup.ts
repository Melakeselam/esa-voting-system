import type { Bot } from "grammy";
import { appUrl, config } from "../config.js";

/** Update types the bot needs (my_chat_member lets it learn the assembly group). */
export const ALLOWED_UPDATES = ["message", "callback_query", "my_chat_member"] as const;

/**
 * Register the bot's command menu and, when a public URL exists, the
 * "Open app" menu button that launches the Mini App. Idempotent.
 */
export async function registerTelegramSurface(bot: Bot): Promise<void> {
  await applyBotIdentity(bot);
  await bot.api.setMyCommands([
    { command: "start", description: "Register / show welcome" },
    { command: "vote", description: "Show resolutions open for voting" },
    { command: "status", description: "Your registration and ballots" },
    { command: "help", description: "How to use this bot" },
  ]);
  // Admins listed in the environment get an /admin entry in their own menu.
  for (const adminId of config.adminIds) {
    try {
      await bot.api.setMyCommands(
        [
          { command: "admin", description: "Open the admin panel" },
          { command: "vote", description: "Show resolutions open for voting" },
          { command: "status", description: "Your registration and ballots" },
          { command: "help", description: "How to use this bot" },
        ],
        { scope: { type: "chat", chat_id: adminId } },
      );
    } catch {
      // The admin may never have opened a chat with the bot yet.
    }
  }

  const url = appUrl();
  if (url) {
    await bot.api.setChatMenuButton({
      menu_button: { type: "web_app", text: "Open app", web_app: { url } },
    });
  } else {
    await bot.api.setChatMenuButton({ menu_button: { type: "commands" } });
  }
}

/**
 * Name and descriptions shown in Telegram (profile, empty chat, share
 * preview). Telegram rate-limits name changes, so each value is only sent
 * when it differs from what Telegram already has.
 */
export async function applyBotIdentity(bot: Bot): Promise<void> {
  const want = {
    name: config.botDisplayName,
    short: config.botShortDescription.slice(0, 120),
    description: config.botDescription.slice(0, 512),
  };
  try {
    const current = await bot.api.getMyName();
    if (current?.name !== want.name) await bot.api.setMyName(want.name);
  } catch (err) {
    console.warn("Could not set the bot name:", (err as Error).message);
  }
  try {
    const current = await bot.api.getMyShortDescription();
    if (current?.short_description !== want.short) await bot.api.setMyShortDescription(want.short);
  } catch (err) {
    console.warn("Could not set the bot short description:", (err as Error).message);
  }
  try {
    const current = await bot.api.getMyDescription();
    if (current?.description !== want.description) await bot.api.setMyDescription(want.description);
  } catch (err) {
    console.warn("Could not set the bot description:", (err as Error).message);
  }
}

export interface WebhookStatus {
  expected: string | null;
  url: string;
  ok: boolean;
  pending_update_count: number;
  last_error_message?: string;
  last_error_date?: number;
}

export async function webhookStatus(bot: Bot): Promise<WebhookStatus> {
  const info = await bot.api.getWebhookInfo();
  const expected = config.publicUrl ? `${config.publicUrl}/telegram` : null;
  return {
    expected,
    url: info.url ?? "",
    ok: expected !== null && info.url === expected,
    pending_update_count: info.pending_update_count,
    last_error_message: info.last_error_message,
    last_error_date: info.last_error_date,
  };
}

/** Point Telegram at this deployment. Requires PUBLIC_URL (or platform equivalent) and WEBHOOK_SECRET. */
export async function registerWebhook(bot: Bot): Promise<WebhookStatus> {
  if (!config.publicUrl) throw new Error("No public URL configured (PUBLIC_URL).");
  if (!config.webhookSecret) throw new Error("WEBHOOK_SECRET must be set in webhook mode.");
  await bot.api.setWebhook(`${config.publicUrl}/telegram`, {
    secret_token: config.webhookSecret,
    allowed_updates: [...ALLOWED_UPDATES],
  });
  return webhookStatus(bot);
}
