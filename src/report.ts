import { config } from "./config.js";
import { memberCounts } from "./services/members.js";
import { listResolutions } from "./services/resolutions.js";
import { ballotCount, tally } from "./services/votes.js";
import { formatLocal } from "./time.js";
import { escapeHtml } from "./bot/ui.js";
import { computeOutcome, thresholdLabel, type VoteOutcome } from "./verdict.js";
import type { Resolution } from "./types.js";

interface ResolutionReport {
  res: Resolution;
  ballots: number;
  counts: number[]; // votes per option index
  totalVotes: number;
  turnoutPct: number;
  leaders: string[]; // winning option(s)
  outcome: VoteOutcome;
}

/** Verdict as one plain-text phrase; empty until the resolution is closed. */
function verdictText(s: ResolutionReport): string {
  if (s.res.status !== "closed") return "";
  if (s.totalVotes === 0) return "No votes cast";
  if (!s.outcome.quorumMet) return "Not valid — quorum not reached";
  if (s.outcome.adopted) return `Adopted: ${s.outcome.winner}`;
  if (s.outcome.winner) return `Not adopted — ${thresholdLabel(s.res.threshold)} not reached`;
  return "Not adopted — tie";
}

export interface AssemblyReport {
  generatedAt: Date;
  membersTotal: number;
  membersRegistered: number;
  sections: ResolutionReport[];
}

export async function buildReport(): Promise<AssemblyReport> {
  const [counts, resolutions] = await Promise.all([memberCounts(), listResolutions()]);
  const sections: ResolutionReport[] = [];

  for (const res of resolutions) {
    const [rows, ballots] = await Promise.all([tally(res.id), ballotCount(res.id)]);
    const optionCounts = res.options.map(
      (_, i) => rows.find((r) => r.choice_index === i)?.votes ?? 0,
    );
    const totalVotes = optionCounts.reduce((a, b) => a + b, 0);
    const top = Math.max(...optionCounts, 0);
    sections.push({
      res,
      ballots,
      counts: optionCounts,
      totalVotes,
      turnoutPct:
        counts.registered === 0 ? 0 : Math.round((ballots / counts.registered) * 100),
      leaders: top === 0 ? [] : res.options.filter((_, i) => optionCounts[i] === top),
      outcome: computeOutcome(res, optionCounts, ballots),
    });
  }

  return {
    generatedAt: new Date(),
    membersTotal: counts.total,
    membersRegistered: counts.registered,
    sections,
  };
}

function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportToCsv(report: AssemblyReport): string {
  const rows: string[] = [
    [
      "resolution",
      "title",
      "status",
      "ballot_type",
      "opened_at",
      "closed_at",
      "ballots_cast",
      "registered_members",
      "turnout_pct",
      "quorum_required",
      "quorum_met",
      "threshold",
      "verdict",
      "option",
      "votes",
      "vote_pct",
      "is_leading",
    ].join(","),
  ];
  for (const s of report.sections) {
    s.res.options.forEach((option, i) => {
      const votes = s.counts[i];
      const pct = s.totalVotes === 0 ? 0 : Math.round((votes / s.totalVotes) * 100);
      rows.push(
        [
          s.res.code,
          csvField(s.res.title),
          s.res.status,
          s.res.anonymous ? "secret" : "open",
          s.res.opened_at ? formatLocal(s.res.opened_at) : "",
          s.res.closed_at ? formatLocal(s.res.closed_at) : "",
          s.ballots,
          report.membersRegistered,
          s.turnoutPct,
          s.res.quorum ?? "",
          s.res.quorum == null ? "" : s.outcome.quorumMet ? "yes" : "no",
          s.res.threshold,
          csvField(verdictText(s)),
          csvField(option),
          votes,
          pct,
          s.leaders.includes(option) ? "yes" : "no",
        ].join(","),
      );
    });
  }
  return rows.join("\n");
}

export function reportToHtml(report: AssemblyReport): string {
  const sections = report.sections
    .map((s) => {
      const status =
        s.res.status === "closed"
          ? '<span class="badge closed">Closed — final</span>'
          : s.res.status === "open"
            ? '<span class="badge open">Open — interim</span>'
            : '<span class="badge draft">Draft</span>';
      const rows = s.res.options
        .map((option, i) => {
          const votes = s.counts[i];
          const pct = s.totalVotes === 0 ? 0 : Math.round((votes / s.totalVotes) * 100);
          const winner = s.res.status === "closed" && s.leaders.length === 1 && s.leaders[0] === option;
          return `<tr class="${winner ? "winner" : ""}">
            <td>${escapeHtml(option)}${winner ? " ✅" : ""}</td>
            <td class="num">${votes}</td>
            <td class="num">${pct}%</td>
            <td class="barcell"><div class="bar" style="width:${pct}%"></div></td>
          </tr>`;
        })
        .join("\n");
      let outcome: string;
      if (s.res.status === "closed") {
        const verdict = verdictText(s);
        outcome = s.outcome.adopted
          ? `✅ <strong>${escapeHtml(verdict)}</strong>`
          : `❌ <strong>${escapeHtml(verdict)}</strong>`;
      } else if (s.totalVotes === 0) {
        outcome = "No votes cast.";
      } else if (s.leaders.length === 1) {
        outcome = `Leading: <strong>${escapeHtml(s.leaders[0])}</strong>`;
      } else {
        outcome = `Tie between: <strong>${s.leaders.map(escapeHtml).join(", ")}</strong>`;
      }
      const quorumMeta =
        s.res.quorum == null
          ? ""
          : ` · Quorum: ${s.res.quorum} (${s.outcome.quorumMet ? "met" : "not met"})`;
      return `<section>
        <h2>${escapeHtml(s.res.code)} — ${escapeHtml(s.res.title)} ${status}</h2>
        ${s.res.description ? `<p class="desc">${escapeHtml(s.res.description)}</p>` : ""}
        <p class="meta">
          ${s.res.anonymous ? "Secret ballot" : "Open ballot"} ·
          Ballots cast: <strong>${s.ballots}</strong> (${s.turnoutPct}% of registered members)${s.counts.reduce((a, b) => a + b, 0) !== s.ballots ? ` · Votes counted (weighted): <strong>${s.counts.reduce((a, b) => a + b, 0)}</strong>` : ""}${quorumMeta}
          · To pass: ${thresholdLabel(s.res.threshold)}
          ${s.res.opened_at ? ` · Opened: ${formatLocal(s.res.opened_at)}` : ""}
          ${s.res.closed_at ? ` · Closed: ${formatLocal(s.res.closed_at)}` : ""}
        </p>
        <table>
          <thead><tr><th>Option</th><th class="num">Votes</th><th class="num">%</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="outcome">${outcome}</p>
      </section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ESA General Assembly — Voting Report</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a2e; max-width: 800px; margin: 40px auto; padding: 0 24px; line-height: 1.5; }
  header { border-bottom: 3px solid #4b2e83; padding-bottom: 16px; margin-bottom: 32px; }
  h1 { margin: 0 0 4px; color: #4b2e83; font-size: 1.6em; }
  .sub { color: #555; margin: 0; }
  h2 { font-size: 1.15em; margin: 36px 0 6px; color: #2b2b4a; }
  .badge { font-family: Arial, sans-serif; font-size: 0.65em; vertical-align: middle; padding: 2px 8px; border-radius: 10px; color: #fff; }
  .badge.closed { background: #b02a2a; } .badge.open { background: #2a7a2a; } .badge.draft { background: #888; }
  .desc { color: #444; margin: 4px 0; }
  .meta, .outcome { font-family: Arial, sans-serif; font-size: 0.85em; color: #555; }
  .outcome { color: #1a1a2e; font-size: 0.95em; }
  table { border-collapse: collapse; width: 100%; font-family: Arial, sans-serif; font-size: 0.9em; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #ddd; }
  .num { text-align: right; width: 60px; }
  .barcell { width: 35%; } .bar { background: #4b2e83; height: 12px; border-radius: 3px; min-width: 2px; }
  tr.winner td { background: #f3eefc; font-weight: bold; }
  footer { margin-top: 48px; border-top: 1px solid #ccc; padding-top: 12px; font-family: Arial, sans-serif; font-size: 0.75em; color: #777; }
</style>
</head>
<body>
<header>
  <h1>Ethiopia Scout Association</h1>
  <p class="sub">General Assembly — Voting Report</p>
  <p class="sub">Generated: ${formatLocal(report.generatedAt)} ·
     Registered voters: <strong>${report.membersRegistered}</strong> of ${report.membersTotal} issued tokens ·
     Resolutions: ${report.sections.length}</p>
</header>
${sections || "<p>No resolutions have been created yet.</p>"}
<footer>
  Secret-ballot integrity: choices are stored with no link to voter identity; the ballot register
  guarantees one vote per accredited member. Full action history is retained in the system audit log.
  Report generated automatically by the ESA Voting System.
</footer>
</body>
</html>`;
}

/** Email the report via Resend (https://resend.com). Throws on failure. */
export async function emailReport(html: string, csv: string): Promise<string> {
  if (!config.resendApiKey || !config.reportEmailFrom || !config.reportEmailTo) {
    throw new Error(
      "Email is not configured. Set RESEND_API_KEY, REPORT_EMAIL_FROM and REPORT_EMAIL_TO.",
    );
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.reportEmailFrom,
      to: [config.reportEmailTo],
      subject: `ESA General Assembly — Voting Report (${formatLocal(new Date())})`,
      html,
      attachments: [
        { filename: "esa-voting-report.csv", content: Buffer.from(csv, "utf8").toString("base64") },
        { filename: "esa-voting-report.html", content: Buffer.from(html, "utf8").toString("base64") },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Resend API error ${response.status}: ${await response.text()}`);
  }
  return config.reportEmailTo;
}
