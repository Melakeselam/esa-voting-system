import { supabase } from "../db.js";
import { getSetting, setSetting } from "./settings.js";

/**
 * People the bot has seen in the assembly group. Telegram does not let a bot
 * list a group's members, so this is learned from chat_member updates (joins,
 * additions, leaves), join requests and messages. Setup shows who is in the
 * group without being a registered member, so an admin can register them or
 * remove them.
 */
export type PersonStatus = "member" | "left" | "kicked" | "pending";

export interface GroupPerson {
  chat_id: number;
  user_id: number;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  status: PersonStatus;
  source: string | null; // joined | added | join_request | posted
  added_by: number | null;
  first_seen_at: string;
  last_seen_at: string;
}

export async function getPerson(chatId: number, userId: number): Promise<GroupPerson | null> {
  const { data, error } = await supabase
    .from("group_people")
    .select("*")
    .eq("chat_id", chatId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as GroupPerson | null;
}

/** Record a sighting. Names refresh, the first source is kept, the status changes only when given. */
export async function seePerson(p: {
  chat_id: number;
  user_id: number;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  status?: PersonStatus;
  source?: string;
  added_by?: number | null;
}): Promise<GroupPerson> {
  const existing = await getPerson(p.chat_id, p.user_id);
  const now = new Date().toISOString();
  const row: GroupPerson = {
    chat_id: p.chat_id,
    user_id: p.user_id,
    first_name: p.first_name ?? existing?.first_name ?? null,
    last_name: p.last_name ?? existing?.last_name ?? null,
    username: p.username ?? existing?.username ?? null,
    status: p.status ?? existing?.status ?? "member",
    source: existing?.source ?? p.source ?? null,
    added_by: p.added_by ?? existing?.added_by ?? null,
    first_seen_at: existing?.first_seen_at ?? now,
    last_seen_at: now,
  };
  const { error } = await supabase.from("group_people").upsert({ ...row } as Record<string, unknown>, { onConflict: "chat_id,user_id" });
  if (error) throw error;
  return row;
}

export async function setPersonStatus(chatId: number, userId: number, status: PersonStatus): Promise<void> {
  const { error } = await supabase
    .from("group_people")
    .update({ status, last_seen_at: new Date().toISOString() })
    .eq("chat_id", chatId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function listPeople(chatId: number): Promise<GroupPerson[]> {
  const { data, error } = await supabase
    .from("group_people")
    .select("*")
    .eq("chat_id", chatId)
    .order("last_seen_at", { ascending: false });
  if (error) throw error;
  return data as GroupPerson[];
}

export async function clearPeople(chatId: number): Promise<void> {
  const { error } = await supabase.from("group_people").delete().eq("chat_id", chatId);
  if (error) throw error;
}

export function personName(p: Pick<GroupPerson, "first_name" | "last_name" | "username" | "user_id">): string {
  const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return name || (p.username ? `@${p.username}` : `ID ${p.user_id}`);
}

/**
 * What happens to someone who joins the group without being registered:
 *  - "flag": the admins are told and can act from Setup (default)
 *  - "remove": the bot removes them at once and tells them to register first
 */
export type GateMode = "flag" | "remove";

export async function getGateMode(): Promise<GateMode> {
  const s = await getSetting<{ mode?: string }>("group_gate");
  return s?.mode === "remove" ? "remove" : "flag";
}

export async function setGateMode(mode: GateMode): Promise<void> {
  await setSetting("group_gate", { mode });
}
