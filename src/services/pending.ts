import { rawDb } from "../db.js";

/**
 * Invitation a Telegram account has scanned (/start inv_<code>) but not yet
 * completed with the password. The Mini App reads it so the member only has
 * to type the password, however they open the app (inline button or the menu
 * button). Kept outside any organisation — the code says which one it is.
 */
const TTL_MS = 72 * 60 * 60 * 1000;

export async function rememberInvitation(userId: number, tokenId: string): Promise<void> {
  const { error } = await rawDb
    .from("pending_invitations")
    .upsert({ telegram_user_id: userId, token_id: tokenId, created_at: new Date().toISOString() }, { onConflict: "telegram_user_id" });
  if (error) throw error;
}

export async function pendingInvitation(userId: number): Promise<string | null> {
  const { data, error } = await rawDb.from("pending_invitations").select("token_id, created_at").eq("telegram_user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (Date.now() - new Date(String(data.created_at)).getTime() > TTL_MS) {
    await clearInvitation(userId);
    return null;
  }
  return String(data.token_id);
}

export async function clearInvitation(userId: number): Promise<void> {
  const { error } = await rawDb.from("pending_invitations").delete().eq("telegram_user_id", userId);
  if (error) throw error;
}
