import { supabase } from "../db.js";
import { currentOrgId } from "../org-context.js";
import type { Presence } from "../types.js";

/**
 * Who is in the session. A registered member is signed in ("available" or
 * "away" — stepped out of the room for a moment — or "busy" on a task) until they tap Logout; then
 * they are "out": not counted as present and unable to vote until they sign
 * in again. Registration itself is kept, so signing in needs no password.
 */
export const PRESENCES: Presence[] = ["available", "away", "busy", "out"];

export async function setPresence(memberId: string, presence: Presence): Promise<void> {
  const { error } = await supabase
    .from("members")
    .update({ presence, presence_at: new Date().toISOString() })
    .eq("id", memberId);
  if (error) throw error;
  liveChanged();
}

export function isSignedIn(m: { presence?: Presence | null }): boolean {
  return (m.presence ?? "available") !== "out";
}

export interface PresenceCounts {
  registered: number; // active members with a Telegram account bound
  signed_in: number;
  available: number;
  away: number;
  busy: number;
}

export async function presenceCounts(): Promise<PresenceCounts> {
  const { data, error } = await supabase
    .from("members")
    .select("presence, telegram_user_id, is_active")
    .not("telegram_user_id", "is", null);
  if (error) throw error;
  const rows = (data ?? []).filter((r) => r.is_active);
  const available = rows.filter((r) => (r.presence ?? "available") === "available").length;
  const away = rows.filter((r) => r.presence === "away").length;
  const busy = rows.filter((r) => r.presence === "busy").length;
  return { registered: rows.length, signed_in: available + away + busy, available, away, busy };
}

export async function setAvatar(memberId: string, avatar: string | null): Promise<void> {
  const { error } = await supabase.from("members").update({ avatar }).eq("id", memberId);
  if (error) throw error;
}

// ---------------------------------------------------------------- language

export type Lang = "en" | "am";

/** The language a person chose (null = both, the bot's default). Kept per person, across organisations. */
export async function getLang(telegramId: number): Promise<Lang | null> {
  const { data, error } = await supabase.from("user_prefs").select("lang").eq("telegram_user_id", telegramId).maybeSingle();
  if (error) throw error;
  const l = data?.lang;
  return l === "en" || l === "am" ? l : null;
}

export async function setLang(telegramId: number, lang: Lang | null): Promise<void> {
  const { error } = await supabase
    .from("user_prefs")
    .upsert({ telegram_user_id: telegramId, lang, updated_at: new Date().toISOString() }, { onConflict: "telegram_user_id" });
  if (error) throw error;
}

/** Pick the English, the Amharic or both lines of a bilingual text for this person. */
export function inLang(lang: Lang | null, en: string, am: string): string {
  return lang === "en" ? en : lang === "am" ? am : `${en}\n${am}`;
}

// ---------------------------------------------------------------- live changes

/**
 * Something the live board shows has changed (presence, a vote opened or
 * closed, a ballot cast). The bot subscribes and refreshes the pinned board
 * of the organisation the change happened in.
 */
type LiveListener = (orgId: string) => void;
const listeners: LiveListener[] = [];

export function onLiveChange(fn: LiveListener): void {
  listeners.push(fn);
}

export function liveChanged(): void {
  const orgId = currentOrgId();
  if (!orgId) return;
  for (const fn of listeners) {
    try {
      fn(orgId);
    } catch (err) {
      console.error("live-change listener failed:", err);
    }
  }
}
