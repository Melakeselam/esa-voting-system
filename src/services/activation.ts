import { randomInt } from "node:crypto";
import { supabase } from "../db.js";
import type { Resolution } from "../types.js";

/**
 * Presence check for a vote: when voting opens, the resolution gets a 4-digit
 * activation code that the admin shows in the meeting (screen or video-call
 * chat). A member must enter it once per resolution before voting, which
 * proves they are following the session. Who activated is recorded; the
 * code itself is only ever shown to admins.
 */
export function newActivationCode(): string {
  return String(randomInt(0, 10_000)).padStart(4, "0");
}

export async function isActivated(resolutionId: string, memberId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("vote_activations")
    .select("*", { count: "exact", head: true })
    .eq("resolution_id", resolutionId)
    .eq("member_id", memberId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

/** True when this member still has to enter the code before voting on `res`. */
export async function needsActivation(res: Resolution, memberId: string): Promise<boolean> {
  if (!res.activation_required || !res.activation_code) return false;
  return !(await isActivated(res.id, memberId));
}

export type ActivateResult =
  | { status: "ok" }
  | { status: "not_required" }
  | { status: "not_open" }
  | { status: "wrong"; attempts_left: number }
  | { status: "locked"; minutes: number };

// Wrong-code attempts per member and resolution: a 4-digit code must not be guessable by brute force.
const MAX_ATTEMPTS = 5;
const LOCK_MS = 10 * 60_000;
const attempts = new Map<string, { count: number; lockedUntil: number }>();

export async function activate(res: Resolution, memberId: string, code: string): Promise<ActivateResult> {
  if (res.status !== "open") return { status: "not_open" };
  if (!res.activation_required || !res.activation_code) return { status: "not_required" };
  if (await isActivated(res.id, memberId)) return { status: "ok" };
  const key = `${res.id}:${memberId}`;
  const a = attempts.get(key);
  if (a && a.lockedUntil > Date.now()) return { status: "locked", minutes: Math.ceil((a.lockedUntil - Date.now()) / 60_000) };
  if (code.trim() !== res.activation_code) {
    // A lock that has run out starts the count afresh; otherwise keep counting.
    const lockExpired = a !== undefined && a.lockedUntil > 0 && a.lockedUntil <= Date.now();
    const count = (lockExpired ? 0 : (a?.count ?? 0)) + 1;
    if (count >= MAX_ATTEMPTS) {
      attempts.set(key, { count: 0, lockedUntil: Date.now() + LOCK_MS });
      return { status: "locked", minutes: LOCK_MS / 60_000 };
    }
    attempts.set(key, { count, lockedUntil: 0 });
    return { status: "wrong", attempts_left: MAX_ATTEMPTS - count };
  }
  attempts.delete(key);
  const { error } = await supabase
    .from("vote_activations")
    .upsert({ resolution_id: res.id, member_id: memberId, activated_at: new Date().toISOString() }, { onConflict: "resolution_id,member_id" });
  if (error) throw error;
  return { status: "ok" };
}

/** Forget who activated (after the code was changed). */
export async function clearActivations(resolutionId: string): Promise<void> {
  const { error } = await supabase.from("vote_activations").delete().eq("resolution_id", resolutionId);
  if (error) throw error;
}

export async function activationCount(resolutionId: string): Promise<number> {
  const { count, error } = await supabase
    .from("vote_activations")
    .select("*", { count: "exact", head: true })
    .eq("resolution_id", resolutionId);
  if (error) throw error;
  return count ?? 0;
}
