import { supabase } from "../db.js";
import { currentOrgId } from "../org-context.js";
import { isPlatformAdmin } from "./orgs.js";

export interface DbAdmin {
  telegram_user_id: number;
  name: string | null;
  added_by: string | null;
  created_at: string;
}

// Admins of each organisation live in the database; cache them briefly per
// organisation so the bot does not hit the database on every update.
const cache = new Map<string, { ids: Set<number>; at: number }>();
const CACHE_MS = 60_000;

async function dbAdminIds(orgId: string): Promise<Set<number>> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ids;
  const { data, error } = await supabase.from("admins").select("telegram_user_id");
  if (error) {
    // A missing table (migration not yet run) must not lock platform admins out.
    console.error("admins lookup failed:", error.message);
    return hit?.ids ?? new Set();
  }
  const ids = new Set((data ?? []).map((r) => Number(r.telegram_user_id)));
  cache.set(orgId, { ids, at: Date.now() });
  return ids;
}

/**
 * True for platform admins (ADMIN_TELEGRAM_IDS — they run Kene Voting System
 * and administer every organisation) and for admins of the current
 * organisation added in the Mini App.
 */
export async function isAdminUser(telegramId: number | undefined): Promise<boolean> {
  if (telegramId === undefined) return false;
  if (isPlatformAdmin(telegramId)) return true;
  const orgId = currentOrgId();
  if (!orgId) return false;
  return (await dbAdminIds(orgId)).has(telegramId);
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
  cache.clear();
}

export async function removeDbAdmin(telegramId: number): Promise<void> {
  const { error } = await supabase.from("admins").delete().eq("telegram_user_id", telegramId);
  if (error) throw error;
  cache.clear();
}
