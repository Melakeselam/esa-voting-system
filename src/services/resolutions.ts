import { supabase } from "../db.js";
import { memberCounts } from "./members.js";
import { newActivationCode } from "./activation.js";
import type { Resolution, ResolutionStatus, Threshold } from "../types.js";

/**
 * Members the quorum percentage is measured against: the count frozen when
 * voting closed, or the live number of active members while it is open.
 */
export async function eligibleFor(res: Pick<Resolution, "eligible_count">): Promise<number> {
  return res.eligible_count ?? (await memberCounts()).active;
}

export async function createResolution(input: {
  title: string;
  description: string | null;
  options: string[];
  anonymous?: boolean;
}): Promise<Resolution> {
  const { count, error: countError } = await supabase
    .from("resolutions")
    .select("*", { count: "exact", head: true });
  if (countError) throw countError;

  const code = `R${(count ?? 0) + 1}`;
  const { data, error } = await supabase
    .from("resolutions")
    .insert({
      code,
      title: input.title,
      description: input.description,
      options: input.options,
      anonymous: input.anonymous ?? true,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Resolution;
}

export async function getByCode(code: string): Promise<Resolution | null> {
  const { data, error } = await supabase
    .from("resolutions")
    .select("*")
    .ilike("code", code.trim())
    .maybeSingle();
  if (error) throw error;
  return data as Resolution | null;
}

export async function getById(id: string): Promise<Resolution | null> {
  const { data, error } = await supabase.from("resolutions").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Resolution | null;
}

export async function listResolutions(status?: ResolutionStatus): Promise<Resolution[]> {
  let query = supabase.from("resolutions").select("*").order("created_at", { ascending: true });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return data as Resolution[];
}

export async function setStatus(
  id: string,
  status: ResolutionStatus,
  closesAt?: Date | null,
): Promise<void> {
  const patch: Record<string, unknown> = { status, awaiting_quorum_since: null };
  if (status === "open") {
    patch.opened_at = new Date().toISOString();
    patch.closes_at = closesAt ? closesAt.toISOString() : null;
    // A fresh presence code for this vote (see services/activation.ts).
    const res = await getById(id);
    if (res?.activation_required) patch.activation_code = newActivationCode();
  }
  if (status === "closed") {
    patch.closed_at = new Date().toISOString();
    patch.eligible_count = (await memberCounts()).active;
  }
  const { error } = await supabase.from("resolutions").update(patch).eq("id", id);
  if (error) throw error;
}

/**
 * Atomically move an open resolution to closed, freezing the number of
 * eligible members the quorum is measured against. Returns null if it was not
 * open (e.g. another process closed it first), so results publish only once.
 */
export async function claimClose(id: string): Promise<{ eligible: number } | null> {
  const eligible = (await memberCounts()).active;
  const { data, error } = await supabase
    .from("resolutions")
    .update({ status: "closed", closed_at: new Date().toISOString(), eligible_count: eligible, awaiting_quorum_since: null })
    .eq("id", id)
    .eq("status", "open")
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0 ? { eligible } : null;
}

/**
 * Put a closed resolution back to open (closed too early, or by mistake).
 * Ballots already cast are kept; the frozen eligible count is cleared so the
 * quorum is measured again when it closes. Returns false if it was not closed.
 */
export async function reopenResolution(id: string, closesAt: Date | null): Promise<boolean> {
  const current = await getById(id);
  const patch: Record<string, unknown> = { status: "open", closes_at: closesAt ? closesAt.toISOString() : null, closed_at: null, eligible_count: null, awaiting_quorum_since: null };
  if (current?.activation_required && !current.activation_code) patch.activation_code = newActivationCode();
  const { data, error } = await supabase
    .from("resolutions")
    .update(patch)
    .eq("id", id)
    .eq("status", "closed")
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** Open resolutions whose auto-close deadline has passed. */
export async function listDueForClose(): Promise<Resolution[]> {
  const { data, error } = await supabase
    .from("resolutions")
    .select("*")
    .eq("status", "open")
    .not("closes_at", "is", null)
    .lte("closes_at", new Date().toISOString());
  if (error) throw error;
  return data as Resolution[];
}

/** Mark an open resolution as past its deadline without quorum. Returns false if it was already marked. */
export async function markAwaitingQuorum(id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("resolutions")
    .update({ awaiting_quorum_since: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "open")
    .is("awaiting_quorum_since", null)
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** Give an open resolution a new deadline `minutes` from now (and stop waiting for quorum). */
export async function extendDeadline(id: string, minutes: number): Promise<Date> {
  const closesAt = new Date(Date.now() + minutes * 60_000);
  const { data, error } = await supabase
    .from("resolutions")
    .update({ closes_at: closesAt.toISOString(), awaiting_quorum_since: null })
    .eq("id", id)
    .eq("status", "open")
    .select("id");
  if (error) throw error;
  if ((data?.length ?? 0) === 0) throw new Error("Voting is not open.");
  return closesAt;
}

/** A fresh draft with the same wording and rules — for voting again after a vote without quorum. */
export async function duplicateAsDraft(res: Resolution): Promise<Resolution> {
  const copy = await createResolution({ title: res.title, description: res.description, options: res.options, anonymous: res.anonymous });
  await updateResolution(copy.id, { quorum: res.quorum, threshold: res.threshold, activation_required: res.activation_required });
  return (await getById(copy.id))!;
}

/** New activation code for an open resolution (the old one leaked, or a new session started). Returns it. */
export async function regenerateActivationCode(id: string): Promise<string> {
  const code = newActivationCode();
  const { error } = await supabase.from("resolutions").update({ activation_code: code }).eq("id", id);
  if (error) throw error;
  return code;
}

export async function setQuorum(id: string, quorum: number | null): Promise<void> {
  const { error } = await supabase.from("resolutions").update({ quorum }).eq("id", id);
  if (error) throw error;
}

export async function setThreshold(id: string, threshold: Threshold): Promise<void> {
  const { error } = await supabase.from("resolutions").update({ threshold }).eq("id", id);
  if (error) throw error;
}

export async function setAnonymous(id: string, anonymous: boolean): Promise<void> {
  const { error } = await supabase.from("resolutions").update({ anonymous }).eq("id", id);
  if (error) throw error;
}

export async function setAnnounceTarget(
  id: string,
  chatId: number,
  threadId: number | null,
): Promise<void> {
  const { error } = await supabase
    .from("resolutions")
    .update({ announce_chat_id: chatId, announce_thread_id: threadId })
    .eq("id", id);
  if (error) throw error;
}

export type ResolutionPatch = Partial<Pick<Resolution, "title" | "description" | "options" | "anonymous" | "quorum" | "threshold" | "activation_required">>;

/** Edit a draft. Returns false if the resolution is not (or no longer) a draft. */
export async function updateResolution(id: string, patch: ResolutionPatch): Promise<boolean> {
  const { data, error } = await supabase
    .from("resolutions")
    .update(patch)
    .eq("id", id)
    .eq("status", "draft")
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** Delete a draft (drafts have no ballots). Returns false if it was not a draft. */
export async function deleteResolution(id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("resolutions")
    .delete()
    .eq("id", id)
    .eq("status", "draft")
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
