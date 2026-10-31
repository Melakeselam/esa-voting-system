import type { Api } from "grammy";
import type { InlineKeyboard } from "grammy";
import { config } from "../config.js";
import { listDbAdmins } from "../services/admins.js";

/** Every admin: the ones from ADMIN_TELEGRAM_IDS plus those added in the Mini App. */
export async function allAdminIds(): Promise<number[]> {
  const ids = new Set<number>(config.adminIds);
  try {
    for (const a of await listDbAdmins()) ids.add(Number(a.telegram_user_id));
  } catch {
    // Table missing before the first migration: env admins still get the message.
  }
  return [...ids];
}

/** Private message to every admin; admins who never opened the bot are skipped silently. Returns how many got it. */
export async function notifyAdmins(api: Api, text: string, keyboard?: InlineKeyboard): Promise<number> {
  let sent = 0;
  for (const id of await allAdminIds()) {
    try {
      await api.sendMessage(id, text, { parse_mode: "HTML", reply_markup: keyboard });
      sent++;
    } catch {
      // No private chat with this admin yet.
    }
  }
  return sent;
}
