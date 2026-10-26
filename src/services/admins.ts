import { supabase } from "../db.js";
import { config } from "../config.js";

export interface DbAdmin {
  telegram_user_id: number;
  name: string | null;
  added_by: string | null;
  created_at: string;
}

// Admins added from the Mini App live in the database; cache them briefly so
// the bot does not hit the database on every update.
let cache: { ids: Set<number>; at: number } | null = null;
const CACHE_MS = 60_000;

async function dbAdminIds(): Promise<Set<number>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.ids;
  const { data, error } = await supabase.from("admins").select("telegram_user_id");
  if (error) {
    // A missing table (migration not yet run) must not lock env admins out.
    console.error("admins lookup failed:", error.message);
    return cache?.ids ?? new Set();
  }
  cache = { ids: new Set((data ?? []).map((r) => Number(r.telegram_user_id))), at: Date.now() };
  return cache.ids;
}

/** True when the user is listed in ADMIN_TELEGRAM_IDS or in the admins table. */
export async function isAdminUser(telegramId: number | undefined): Promise<boolean> {
  if (telegramId === undefined) return false;
  if (config.adminIds.includes(telegramId)) return true;
  return (await dbAdminIds()).has(telegramId);
}

export async function listDbAdmins(): Promise<DbAdmin[]> {
  const { data, error } = await supabase.from("admins").select("*").order("created_at");
  if (error) throw error;
  return data as DbAdmin[];
}

export async function addDbAdmin(telegramId: number, name: string | null, addedBy: number): Promise<void> {
  const { error } = await supabase
    .from("admins")
    .upsert({ telegram_user_id: telegramId, name, added_by: String(addedBy) }, { onConflict: "telegram_user_id" });
  if (error) throw error;
  cache = null;
}

export async function removeDbAdmin(telegramId: number): Promise<void> {
  const { error } = await supabase.from("admins").delete().eq("telegram_user_id", telegramId);
  if (error) throw error;
  cache = null;
}
