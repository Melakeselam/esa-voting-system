import { deleteSetting, getSetting, setSetting } from "./settings.js";

/**
 * Invitation a Telegram account has scanned (/start inv_<code>) but not yet
 * completed with the password. The Mini App reads it so the member only has
 * to type the password, however they open the app (inline button or the menu
 * button). Kept in app_settings so it survives restarts and pod changes.
 */
const TTL_MS = 72 * 60 * 60 * 1000;

interface PendingInvitation {
  token_id: string;
  at: string;
}

const key = (userId: number) => `pending_inv:${userId}`;

export async function rememberInvitation(userId: number, tokenId: string): Promise<void> {
  await setSetting(key(userId), { token_id: tokenId, at: new Date().toISOString() } satisfies PendingInvitation);
}

export async function pendingInvitation(userId: number): Promise<string | null> {
  const p = await getSetting<PendingInvitation>(key(userId));
  if (!p) return null;
  if (Date.now() - new Date(p.at).getTime() > TTL_MS) {
    await deleteSetting(key(userId));
    return null;
  }
  return p.token_id;
}

export async function clearInvitation(userId: number): Promise<void> {
  await deleteSetting(key(userId));
}
