import type { Resolution, Threshold } from "./types.js";

/**
 * Outcome of a vote measured against the resolution's quorum and threshold.
 * Options named "Abstain"/"Abstention" are excluded from the threshold
 * denominator, following normal assembly practice: abstentions count toward
 * quorum (the member did cast a ballot) but not toward the majority.
 */
export interface VoteOutcome {
  quorumMet: boolean; // true when no quorum is set
  quorumRequired: number | null; // ballots needed: ceil(eligible × quorum% / 100), at least 1; null when no quorum
  eligible: number; // members the quorum percentage is measured against
  abstentions: number;
  countable: number; // votes excluding abstentions
  leaders: string[]; // leading non-abstain option(s)
  winner: string | null; // single leading option, if any
  winnerVotes: number;
  thresholdMet: boolean;
  adopted: boolean; // quorumMet && thresholdMet
}

export function isAbstainOption(label: string): boolean {
  return /^abstain|^abstention/i.test(label.trim());
}

export function thresholdLabel(threshold: Threshold): string {
  return threshold === "two_thirds" ? "2/3 majority" : "simple majority";
}

/** Ballots a quorum percentage demands from `eligible` members; never 0 when a quorum is set. */
export function quorumRequired(quorumPct: number | null, eligible: number): number | null {
  if (quorumPct == null) return null;
  return Math.max(1, Math.ceil((eligible * quorumPct) / 100));
}

export function computeOutcome(
  res: Pick<Resolution, "options" | "threshold" | "quorum">,
  counts: number[],
  totalBallots: number,
  eligible: number,
): VoteOutcome {
  const abstentions = res.options.reduce(
    (sum, option, i) => (isAbstainOption(option) ? sum + counts[i] : sum),
    0,
  );
  const totalVotes = counts.reduce((a, b) => a + b, 0);
  const countable = totalVotes - abstentions;

  const countableCounts = res.options.map((option, i) =>
    isAbstainOption(option) ? 0 : counts[i],
  );
  const top = Math.max(...countableCounts, 0);
  const leaders =
    top === 0 ? [] : res.options.filter((_, i) => countableCounts[i] === top);
  const winner = leaders.length === 1 ? leaders[0] : null;
  const winnerVotes = winner === null ? 0 : top;

  const thresholdMet =
    winner !== null &&
    countable > 0 &&
    (res.threshold === "two_thirds"
      ? winnerVotes * 3 >= countable * 2
      : winnerVotes * 2 > countable);

  const required = quorumRequired(res.quorum, eligible);
  const quorumMet = required === null || totalBallots >= required;

  return {
    quorumMet,
    quorumRequired: required,
    eligible,
    abstentions,
    countable,
    leaders,
    winner,
    winnerVotes,
    thresholdMet,
    adopted: quorumMet && thresholdMet,
  };
}
