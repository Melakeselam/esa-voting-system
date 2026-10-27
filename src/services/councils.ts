import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { supabase } from "../db.js";
import type { Council, Member } from "../types.js";
import { generateCredentials, type CredentialRow } from "./credentials.js";

/**
 * Councils are the bodies (regions, sections, committees) that receive a set
 * number of voting invitations. Every invitation is a members row linked to
 * its council with a seat number; the token prefix is the council code.
 */

export interface CouncilSummary extends Council {
  issued: number;      // invitations created
  registered: number;  // delegates who have bound a Telegram account
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function randomString(length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** "Addis Ababa Regional Council" → "AARC"; "Oromia" → "ORO". Letters/digits only, 2–6 chars. */
export function suggestCode(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  let code = words.length >= 2 ? words.map((w) => w[0]).join("") : (words[0] ?? "").slice(0, 3);
  code = code.slice(0, 6);
  if (code.length < 2) code = ("CNL" + code).slice(0, 3);
  return code;
}

export async function listCouncils(): Promise<CouncilSummary[]> {
  const [{ data: councils, error }, { data: members, error: mErr }] = await Promise.all([
    supabase.from("councils").select("*").order("name", { ascending: true }),
    supabase.from("members").select("council_id, telegram_user_id").not("council_id", "is", null),
  ]);
  if (error) throw error;
  if (mErr) throw mErr;
  const issued = new Map<string, number>();
  const registered = new Map<string, number>();
  for (const m of members ?? []) {
    const id = String(m.council_id);
    issued.set(id, (issued.get(id) ?? 0) + 1);
    if (m.telegram_user_id !== null) registered.set(id, (registered.get(id) ?? 0) + 1);
  }
  return (councils ?? []).map((c: Council) => ({ ...c, issued: issued.get(c.id) ?? 0, registered: registered.get(c.id) ?? 0 }));
}

export async function getCouncil(id: string): Promise<CouncilSummary | null> {
  const all = await listCouncils();
  return all.find((c) => c.id === id) ?? null;
}

export async function findCouncilByName(name: string): Promise<Council | null> {
  const { data, error } = await supabase.from("councils").select("*").ilike("name", name.trim().replace(/[%_]/g, "")).maybeSingle();
  if (error) throw error;
  return (data as Council | null) ?? null;
}

export async function createCouncil(input: { name: string; seats: number; code?: string | null }): Promise<Council> {
  const base = (input.code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || suggestCode(input.name);
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = attempt === 0 ? base : `${base.slice(0, 5)}${attempt + 1}`;
    const { data, error } = await supabase
      .from("councils")
      .insert({ name: input.name.trim(), code, seats: input.seats })
      .select("*")
      .single();
    if (!error) return data as Council;
    // Unique violation on the code → try another suffix; on the name → surface it.
    if (error.code !== "23505" || /name/.test(error.message ?? "")) throw error;
  }
  // Last resort: random code.
  const { data, error } = await supabase
    .from("councils")
    .insert({ name: input.name.trim(), code: randomString(4), seats: input.seats })
    .select("*")
    .single();
  if (error) throw error;
  return data as Council;
}

export async function updateCouncil(id: string, patch: { name?: string; seats?: number }): Promise<Council | null> {
  const clean: Record<string, unknown> = {};
  if (patch.name !== undefined) clean.name = patch.name.trim();
  if (patch.seats !== undefined) clean.seats = patch.seats;
  if (Object.keys(clean).length === 0) return (await supabase.from("councils").select("*").eq("id", id).maybeSingle()).data as Council | null;
  const { data, error } = await supabase.from("councils").update(clean).eq("id", id).select("*");
  if (error) throw error;
  const row = (data ?? [])[0] as Council | undefined;
  if (row && patch.name !== undefined) {
    // Keep the members' region label in step with the council name.
    await supabase.from("members").update({ region: row.name }).eq("council_id", id);
  }
  return row ?? null;
}

/** Deletes a council that has no invitations yet. Returns false when it still has members. */
export async function deleteCouncil(id: string): Promise<boolean> {
  const { count, error } = await supabase.from("members").select("*", { count: "exact", head: true }).eq("council_id", id);
  if (error) throw error;
  if ((count ?? 0) > 0) return false;
  const { error: dErr } = await supabase.from("councils").delete().eq("id", id);
  if (dErr) throw dErr;
  return true;
}

export type Invitation = Omit<Member, "password_hash">;

export async function councilMembers(councilId: string): Promise<Invitation[]> {
  const { data, error } = await supabase
    .from("members")
    .select("id, token_id, full_name, region, telegram_user_id, registered_at, failed_attempts, locked_until, is_active, council_id, seat_no")
    .eq("council_id", councilId)
    .order("seat_no", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Invitation[];
}

/**
 * Create invitations (token + password) for a council: one per name; a null
 * name is an anonymous delegate seat. Seat numbers continue from the last one.
 */
export async function issueInvitations(council: Council, names: (string | null)[]): Promise<CredentialRow[]> {
  const existing = await councilMembers(council.id);
  let seat = existing.reduce((m, r) => Math.max(m, r.seat_no ?? 0), 0);
  const people = names.map((name) => ({ name, region: council.name, council_id: council.id, seat_no: ++seat }));
  return generateCredentials(people, council.code);
}

/**
 * Give every invitation of the council that is NOT registered yet a fresh
 * password, so the invitation sheet can be printed again after the original
 * file was lost. Registered delegates are untouched.
 */
export async function reissuePasswords(council: Council): Promise<CredentialRow[]> {
  const members = await councilMembers(council.id);
  const rows: CredentialRow[] = [];
  for (const m of members) {
    if (m.telegram_user_id !== null || !m.is_active) continue;
    const password = randomString(10);
    const hash = await bcrypt.hash(password, 10);
    const { error } = await supabase
      .from("members")
      .update({ password_hash: hash, failed_attempts: 0, locked_until: null })
      .eq("id", m.id);
    if (error) throw error;
    rows.push({ token_id: m.token_id, password, full_name: m.full_name, region: m.region, seat_no: m.seat_no });
  }
  return rows;
}
