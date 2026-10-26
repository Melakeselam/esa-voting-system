import { supabase } from "../db.js";
import type { CastVoteResult, TallyRow } from "../types.js";

export async function castVote(
  resolutionId: string,
  memberId: string,
  choiceIndex: number,
): Promise<CastVoteResult> {
  const { data, error } = await supabase.rpc("cast_vote", {
    p_resolution_id: resolutionId,
    p_member_id: memberId,
    p_choice: choiceIndex,
  });
  if (error) throw error;
  return data as CastVoteResult;
}

export async function tally(resolutionId: string): Promise<TallyRow[]> {
  const { data, error } = await supabase.rpc("tally_votes", { p_resolution_id: resolutionId });
  if (error) throw error;
  return (data ?? []) as TallyRow[];
}

export async function ballotCount(resolutionId: string): Promise<number> {
  const { count, error } = await supabase
    .from("ballots")
    .select("*", { count: "exact", head: true })
    .eq("resolution_id", resolutionId);
  if (error) throw error;
  return count ?? 0;
}

/** Resolution ids the member has cast a ballot in. */
export async function memberBallots(memberId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("ballots")
    .select("resolution_id")
    .eq("member_id", memberId);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.resolution_id as string));
}

/** Current choice per resolution for open (non-secret) ballots the member has voted on. */
export async function memberChoices(memberId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("votes")
    .select("resolution_id, choice_index")
    .eq("member_id", memberId);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.resolution_id as string, r.choice_index as number]));
}
