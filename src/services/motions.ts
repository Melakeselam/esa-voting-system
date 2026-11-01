import { supabase } from "../db.js";
import { createResolution, getById as getResolution, setAnnounceTarget, updateResolution } from "./resolutions.js";
import { getSetting, setSetting } from "./settings.js";
import type { Member, Motion, MotionKind, MotionStatus, Resolution } from "../types.js";

/**
 * Motions: what a member proposes before the assembly votes on it.
 *
 *   proposed ──second──▶ seconded ──chair states it──▶ stated ──put to the vote──▶ voting ──▶ adopted | lost
 *       │                    │                            │
 *       ├─ withdrawn (by the mover, until the chair states it)
 *       ├─ lapsed (nobody seconded it)
 *       └─ out_of_order / merged (the chair's ruling, until it is put to the vote)
 *
 * While a motion is stated (under debate) members may move amendments to it:
 * motions of kind "amendment" that go through the same stages; an adopted
 * amendment replaces the motion's wording. The motion itself can only be put
 * to the vote once no amendment to it is still pending.
 */

/** Stages before a decision: a motion here can still change. */
export const PENDING: MotionStatus[] = ["proposed", "seconded", "stated", "voting"];

export interface MotionRules {
  /** Constitutional motions moved after this moment are flagged as late (the chair may still accept them). */
  notice_deadline: string | null;
  /** The seconder must belong to another council than the mover. */
  second_other_council: boolean;
}

const RULES_KEY = "motion_rules";

export async function getMotionRules(): Promise<MotionRules> {
  const s = await getSetting<Partial<MotionRules>>(RULES_KEY);
  return { notice_deadline: s?.notice_deadline ?? null, second_other_council: Boolean(s?.second_other_council) };
}

export async function setMotionRules(rules: MotionRules): Promise<void> {
  await setSetting(RULES_KEY, rules);
}

export function memberName(m: Pick<Member, "full_name" | "token_id">): string {
  return m.full_name || m.token_id;
}

export async function getMotion(id: string): Promise<Motion | null> {
  const { data, error } = await supabase.from("motions").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Motion | null;
}

export async function listMotions(): Promise<Motion[]> {
  const { data, error } = await supabase.from("motions").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Motion[];
}

export async function amendmentsOf(parentId: string): Promise<Motion[]> {
  const { data, error } = await supabase.from("motions").select("*").eq("parent_id", parentId).order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Motion[];
}

export async function motionOfResolution(resolutionId: string): Promise<Motion | null> {
  const { data, error } = await supabase.from("motions").select("*").eq("resolution_id", resolutionId).maybeSingle();
  if (error) throw error;
  return data as Motion | null;
}

async function patch(id: string, values: Record<string, unknown>, fromStatus?: MotionStatus[]): Promise<Motion | null> {
  let q = supabase.from("motions").update(values).eq("id", id);
  if (fromStatus?.length === 1) q = q.eq("status", fromStatus[0]);
  const { data, error } = await q.select("*");
  if (error) throw error;
  const row = (data ?? [])[0] as Motion | undefined;
  if (!row) return null;
  // Several allowed starting stages: the caller checked them on a fresh read.
  return row;
}

export interface NewMotion {
  kind: MotionKind;
  title: string;
  body: string;
  parent?: Motion | null;
  mover: { member_id: string | null; name: string };
  seconder?: { member_id: string | null; name: string } | null;
  from_floor?: boolean;
  chat_id?: number | null;
  thread_id?: number | null;
}

export async function createMotion(input: NewMotion): Promise<Motion> {
  let code: string;
  if (input.parent) {
    const n = (await amendmentsOf(input.parent.id)).length + 1;
    code = `${input.parent.code}-A${n}`;
  } else {
    const { count, error } = await supabase.from("motions").select("*", { count: "exact", head: true }).is("parent_id", null);
    if (error) throw error;
    code = `M${(count ?? 0) + 1}`;
  }
  const rules = await getMotionRules();
  const late = input.kind === "constitutional" && rules.notice_deadline !== null && Date.now() > new Date(rules.notice_deadline).getTime();
  const seconded = Boolean(input.seconder);
  const { data, error } = await supabase
    .from("motions")
    .insert({
      code,
      kind: input.parent ? "amendment" : input.kind,
      parent_id: input.parent?.id ?? null,
      title: input.title,
      body: input.body,
      status: seconded ? "seconded" : "proposed",
      mover_member_id: input.mover.member_id,
      mover_name: input.mover.name,
      seconder_member_id: input.seconder?.member_id ?? null,
      seconder_name: input.seconder?.name ?? null,
      seconded_at: seconded ? new Date().toISOString() : null,
      from_floor: Boolean(input.from_floor),
      late_notice: late,
      chat_id: input.chat_id ?? input.parent?.chat_id ?? null,
      thread_id: input.thread_id ?? input.parent?.thread_id ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Motion;
}

export async function setCard(id: string, chatId: number, threadId: number | null, messageId: number): Promise<void> {
  const { error } = await supabase.from("motions").update({ chat_id: chatId, thread_id: threadId, message_id: messageId }).eq("id", id);
  if (error) throw error;
}

export type SecondRefusal = "not_found" | "not_proposed" | "own_motion" | "same_council";

/** Second a proposed motion. The conditional update makes the first seconder win when two tap at once. */
export async function secondMotion(id: string, member: Member): Promise<{ motion: Motion } | { refused: SecondRefusal }> {
  const m = await getMotion(id);
  if (!m) return { refused: "not_found" };
  if (m.status !== "proposed") return { refused: "not_proposed" };
  if (m.mover_member_id === member.id) return { refused: "own_motion" };
  const rules = await getMotionRules();
  if (rules.second_other_council && member.council_id && m.mover_member_id) {
    const { data: mover } = await supabase.from("members").select("council_id").eq("id", m.mover_member_id).maybeSingle();
    if (mover?.council_id && mover.council_id === member.council_id) return { refused: "same_council" };
  }
  const row = await patch(
    id,
    { status: "seconded", seconder_member_id: member.id, seconder_name: memberName(member), seconded_at: new Date().toISOString() },
    ["proposed"],
  );
  return row ? { motion: row } : { refused: "not_proposed" };
}

/** The mover takes the motion back — possible until the chair states it. */
export async function withdrawMotion(m: Motion, reason: string | null): Promise<Motion | null> {
  if (m.status !== "proposed" && m.status !== "seconded") return null;
  return patch(m.id, { status: "withdrawn", reason, decided_at: new Date().toISOString() }, [m.status]);
}

/** The chair states the motion: it is now before the assembly and open for debate and amendments. */
export async function stateMotion(m: Motion): Promise<Motion | null> {
  if (m.status !== "seconded") return null;
  return patch(m.id, { status: "stated", stated_at: new Date().toISOString() }, ["seconded"]);
}

/** Close a motion without a vote: ruled out of order, merged into another, or lapsed for want of a seconder. */
export async function closeMotion(
  m: Motion,
  status: "out_of_order" | "merged" | "lapsed",
  reason: string | null,
  mergedInto: string | null = null,
): Promise<Motion | null> {
  const allowed: MotionStatus[] = status === "lapsed" ? ["proposed"] : ["proposed", "seconded", "stated"];
  if (!allowed.includes(m.status)) return null;
  const row = await patch(m.id, { status, reason, merged_into: mergedInto, decided_at: new Date().toISOString() }, [m.status]);
  // Amendments still pending on a motion that will not be voted fall with it.
  if (row) {
    for (const a of await amendmentsOf(m.id)) {
      if (a.status === "proposed" || a.status === "seconded" || a.status === "stated") {
        await patch(a.id, { status: "out_of_order", reason: `The motion it amends (${m.code}) was closed.`, decided_at: new Date().toISOString() }, [a.status]);
      }
    }
  }
  return row;
}

/** The chair rewords a motion before the vote; the wording as moved is kept. */
export async function rewordMotion(m: Motion, title: string, body: string): Promise<Motion | null> {
  if (m.status !== "proposed" && m.status !== "seconded" && m.status !== "stated") return null;
  return patch(m.id, { title, body, original_body: m.original_body ?? (body !== m.body ? m.body : null) }, [m.status]);
}

export class PendingAmendmentsError extends Error {
  constructor(public codes: string[]) {
    super(`Amendments still pending: ${codes.join(", ")}. Put them to the vote, or close them, first.`);
  }
}

/**
 * Put a stated motion to the vote: a draft resolution (For / Against /
 * Abstain) linked to it, announced in the motion's topic. Constitutional
 * motions — and amendments to them — need a two-thirds majority.
 */
export async function putToVote(m: Motion): Promise<Resolution | null> {
  if (m.status !== "stated") return null;
  if (m.kind !== "amendment") {
    const pending = (await amendmentsOf(m.id)).filter((a) => PENDING.includes(a.status));
    if (pending.length) throw new PendingAmendmentsError(pending.map((a) => a.code));
  }
  const parent = m.parent_id ? await getMotion(m.parent_id) : null;
  const constitutional = m.kind === "constitutional" || parent?.kind === "constitutional";
  const description =
    (m.kind === "amendment" && parent ? `Amendment to ${parent.code} — ${parent.title}. Proposed wording:\n` : "") +
    `${m.body}\n\nMoved by ${m.mover_name ?? "—"}, seconded by ${m.seconder_name ?? "—"} (${m.code}).`;
  const res = await createResolution({
    title: m.kind === "amendment" && parent ? `${m.code}: amend ${parent.code} — ${m.title}` : `${m.code} — ${m.title}`,
    description: description.slice(0, 2000),
    options: ["For", "Against", "Abstain"],
  });
  await updateResolution(res.id, { threshold: constitutional ? "two_thirds" : "simple" });
  const { error } = await supabase.from("resolutions").update({ motion_id: m.id }).eq("id", res.id);
  if (error) throw error;
  if (m.chat_id) await setAnnounceTarget(res.id, m.chat_id, m.thread_id ?? null);
  const row = await patch(m.id, { status: "voting", resolution_id: res.id }, ["stated"]);
  if (!row) return null;
  return (await getResolution(res.id))!;
}

/**
 * Voting on a motion's resolution closed: the motion is adopted or lost. An
 * adopted amendment rewrites the motion it amends (its earlier wording is
 * kept on the amendment, so a reopened vote can put it back).
 */
export async function settleMotionVote(resolutionId: string, adopted: boolean): Promise<Motion[]> {
  const m = await motionOfResolution(resolutionId);
  if (!m || m.status !== "voting") return [];
  const changed: Motion[] = [];
  const row = await patch(m.id, { status: adopted ? "adopted" : "lost", decided_at: new Date().toISOString() }, ["voting"]);
  if (!row) return [];
  changed.push(row);
  if (adopted && m.kind === "amendment" && m.parent_id) {
    const parent = await getMotion(m.parent_id);
    if (parent && parent.status === "stated") {
      const p = await patch(parent.id, { body: m.body, original_body: parent.original_body ?? parent.body }, ["stated"]);
      await patch(m.id, { replaced_body: parent.body });
      if (p) changed.push(p);
    }
  }
  return changed;
}

/** A motion's vote was reopened: back to voting (an adopted amendment's change to the motion is undone). */
export async function reopenMotionVote(resolutionId: string): Promise<Motion[]> {
  const m = await motionOfResolution(resolutionId);
  if (!m || (m.status !== "adopted" && m.status !== "lost")) return [];
  const changed: Motion[] = [];
  if (m.status === "adopted" && m.kind === "amendment" && m.parent_id && m.replaced_body !== null) {
    const parent = await getMotion(m.parent_id);
    if (parent && parent.status === "stated" && parent.body === m.body) {
      const p = await patch(parent.id, { body: m.replaced_body }, ["stated"]);
      if (p) changed.push(p);
    }
  }
  const row = await patch(m.id, { status: "voting", decided_at: null, replaced_body: null }, [m.status]);
  if (row) changed.unshift(row);
  return changed;
}

/** The draft resolution of a motion was deleted: the motion is back under debate. (By the motion's id: the database has already cleared its link to the deleted resolution.) */
export async function cancelMotionVote(motionId: string): Promise<Motion | null> {
  const m = await getMotion(motionId);
  if (!m || m.status !== "voting") return null;
  return patch(m.id, { status: "stated", resolution_id: null }, ["voting"]);
}
