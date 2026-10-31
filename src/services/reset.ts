import { audit, supabase } from "../db.js";
import { memberCounts } from "./members.js";
import { getSetting, setSetting } from "./settings.js";

/**
 * Wiping an assembly: councils, members (registered and invited), resolutions
 * with their ballots and votes, the learned group, its topics and people, and
 * the group-related settings. Admin accounts and the audit log stay, and the
 * reset itself is audited. Used when a group was deleted and a fresh one takes
 * its place, so names and codes never clash with leftovers.
 */
export interface AssemblySummary {
  councils: number;
  members: number; // all member rows
  registered: number; // linked to a Telegram account
  invitations: number; // not yet registered
  resolutions: number;
}

async function count(table: string): Promise<number> {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function assemblySummary(): Promise<AssemblySummary> {
  const [m, councils, resolutions] = await Promise.all([memberCounts(), count("councils"), count("resolutions")]);
  return { councils, members: m.total, registered: m.registered, invitations: m.total - m.registered, resolutions };
}

/** Settings that describe preferences rather than the assembly; they survive a reset. */
const KEEP_SETTINGS = ["group_gate", "group_reset_mode"];

async function wipe(table: string, notNullColumn: string): Promise<void> {
  const { error } = await supabase.from(table).delete().not(notNullColumn, "is", null);
  if (error) throw error;
}

export async function resetAssembly(by: string | number, reason: string): Promise<AssemblySummary> {
  const before = await assemblySummary();
  // Children first (the real database also cascades, the fake one does not).
  await wipe("votes", "id");
  await wipe("ballots", "resolution_id");
  await wipe("vote_activations", "resolution_id");
  await wipe("resolutions", "id");
  await wipe("members", "id");
  await wipe("councils", "id");
  await wipe("chat_topics", "chat_id");
  await wipe("group_people", "chat_id");
  let q = supabase.from("app_settings").delete().not("key", "is", null);
  for (const k of KEEP_SETTINGS) q = q.neq("key", k);
  const { error } = await q;
  if (error) throw error;
  await audit(by, "assembly_reset", { ...before, reason });
  return before;
}

/**
 * What happens to the assembly data when the bot is removed from its group:
 *  - "ask": keep everything and offer the admins a reset (default)
 *  - "auto": wipe at once
 */
export type ResetMode = "ask" | "auto";

export async function getResetMode(): Promise<ResetMode> {
  const s = await getSetting<{ mode?: string }>("group_reset_mode");
  return s?.mode === "auto" ? "auto" : "ask";
}

export async function setResetMode(mode: ResetMode): Promise<void> {
  await setSetting("group_reset_mode", { mode });
}

export function summaryText(s: AssemblySummary): string {
  return (
    `${s.councils} council${s.councils === 1 ? "" : "s"}, ${s.members} member${s.members === 1 ? "" : "s"} ` +
    `(${s.registered} registered, ${s.invitations} invitation${s.invitations === 1 ? "" : "s"} not yet used), ` +
    `${s.resolutions} resolution${s.resolutions === 1 ? "" : "s"} with their ballots`
  );
}
