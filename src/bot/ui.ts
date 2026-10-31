import { InlineKeyboard } from "grammy";
import { appUrl, config } from "../config.js";
import { formatLocal } from "../time.js";
import { computeOutcome, thresholdLabel } from "../verdict.js";
import type { Resolution, TallyRow } from "../types.js";

export function resolutionCard(res: Resolution): string {
  const lines = [`🗳 <b>${escapeHtml(res.code)} — ${escapeHtml(res.title)}</b>`];
  if (res.description) lines.push("", escapeHtml(res.description));
  lines.push("", res.anonymous ? "🔒 Secret ballot — your choice is anonymous and final." : "✏️ Open ballot — you may change your vote until voting closes.");
  lines.push(`📏 To pass: ${thresholdLabel(res.threshold)}`);
  if (res.quorum) lines.push(`👥 Quorum: ${res.quorum}% of eligible members must cast a ballot`);
  if (res.status === "open") {
    lines.push("🟢 Voting is <b>OPEN</b>.");
    if (res.closes_at) lines.push(`⏰ Voting closes automatically: <b>${formatLocal(res.closes_at)}</b>`);
  }
  if (res.status === "closed") lines.push("🔴 Voting is <b>CLOSED</b>.");
  if (res.status === "draft") lines.push("⚪ Not yet open for voting.");
  return lines.join("\n");
}

/** Option buttons, plus an "open in app" button when the Mini App is available (private chats only). */
export function voteKeyboard(res: Resolution): InlineKeyboard {
  const kb = new InlineKeyboard();
  res.options.forEach((option, i) => {
    kb.text(option, `v|${res.id}|${i}`).row();
  });
  const url = appUrl();
  if (url) kb.webApp("📱 Open in app", `${url}?r=${res.id}`);
  return kb;
}

/** Confirm/back step shown after a member taps an option. */
export function confirmKeyboard(res: Resolution, choiceIndex: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Confirm vote", `vc|${res.id}|${choiceIndex}`)
    .text("↩️ Back", `vb|${res.id}`);
}

/** Single "open the Mini App" button (web_app buttons work in private chats only). */
export function appKeyboard(text = "📱 Open app", path = ""): InlineKeyboard | undefined {
  const url = appUrl();
  if (!url) return undefined;
  return new InlineKeyboard().webApp(text, `${url}${path}`);
}

/** The sign-in card pinned in the group's "Register / Sign in" topic. */
export function signInCard(groupTitle: string | null): string {
  return (
    `📝 <b>Sign in${groupTitle ? ` — ${escapeHtml(groupTitle)}` : ""}</b>\n\n` +
    `Delegates register once with the invitation code from the National Office, then vote from their phone.\n\n` +
    `1️⃣ Tap <b>Register with your code</b> below.\n` +
    `2️⃣ Enter your code (ESA-2026-XXXXX) and the password from your invitation sheet. This happens in a private chat with the bot, so nobody here sees it.\n` +
    `3️⃣ Done — ballots and results reach you in that private chat; announcements stay here in the group.\n\n` +
    `Already registered? Nothing more to do. Lost your code? Ask the National Office.`
  );
}

/** Buttons under the sign-in card. Inline web-app buttons do not work in groups, so these are links. */
export function signInKeyboard(botUsername: string): InlineKeyboard {
  const chat = `https://t.me/${botUsername}?start=register`;
  if (config.miniAppShortName) {
    return new InlineKeyboard()
      .url("📝 Register with your code", `https://t.me/${botUsername}/${config.miniAppShortName}?startapp=register`)
      .row()
      .url("💬 Open a private chat with the bot", chat);
  }
  return new InlineKeyboard().url("📝 Register with your code", chat);
}

export function announceKeyboard(res: Resolution, botUsername: string): InlineKeyboard {
  return new InlineKeyboard().url(
    "🗳 Vote in private chat",
    `https://t.me/${botUsername}?start=vote_${res.id}`,
  );
}

/** `eligible` = members the quorum percentage applies to (see eligibleFor()). */
export function resultsText(res: Resolution, rows: TallyRow[], totalBallots: number, eligible: number): string {
  const counts = res.options.map((_, i) => rows.find((r) => r.choice_index === i)?.votes ?? 0);
  const totalVotes = counts.reduce((a, b) => a + b, 0);
  const max = Math.max(...counts, 1);
  const outcome = computeOutcome(res, counts, totalBallots, eligible);

  const lines = [
    `📊 <b>Results — ${escapeHtml(res.code)}: ${escapeHtml(res.title)}</b>`,
    res.status === "closed" ? "🔴 Final — voting closed." : "🟢 Interim — voting still open.",
    `Ballots cast: <b>${totalBallots}</b>` + (totalVotes !== totalBallots ? ` · Votes counted (weighted): <b>${totalVotes}</b>` : ""),
  ];
  if (res.quorum) {
    lines.push(
      `Quorum: ${res.quorum}% of ${eligible} members = ${outcome.quorumRequired} ballots — ${outcome.quorumMet ? "✅ met" : `❌ not met (${totalBallots} of ${outcome.quorumRequired})`}`,
    );
  }
  lines.push(
    `To pass: ${thresholdLabel(res.threshold)}${outcome.abstentions > 0 ? " (abstentions excluded)" : ""}`,
    "",
  );
  res.options.forEach((option, i) => {
    const n = counts[i];
    const pct = totalVotes === 0 ? 0 : Math.round((n / totalVotes) * 100);
    const bar = "▓".repeat(Math.round((n / max) * 10)) || "░";
    lines.push(`${escapeHtml(option)}\n${bar} <b>${n}</b> (${pct}%)`);
  });

  if (res.status !== "closed") {
    // Interim view: show who is leading, no verdict yet.
    if (outcome.leaders.length === 1) {
      lines.push("", `▶️ Leading: <b>${escapeHtml(outcome.winner!)}</b>`);
    } else if (outcome.leaders.length > 1) {
      lines.push("", `⚖️ Tie between: ${outcome.leaders.map(escapeHtml).join(", ")}`);
    }
    return lines.join("\n");
  }

  // Final verdict.
  if (totalVotes === 0) {
    lines.push("", "❌ No votes were cast.");
  } else if (!outcome.quorumMet) {
    lines.push("", "⚠️ <b>Quorum not reached — the vote is not valid.</b>");
  } else if (outcome.adopted) {
    lines.push("", `✅ <b>ADOPTED: ${escapeHtml(outcome.winner!)}</b>`);
  } else if (outcome.winner) {
    lines.push(
      "",
      `❌ <b>Not adopted</b> — “${escapeHtml(outcome.winner)}” leads but does not reach the required ${thresholdLabel(res.threshold)}.`,
    );
  } else {
    lines.push("", `⚖️ <b>Tie</b> between ${outcome.leaders.map(escapeHtml).join(", ")} — not adopted.`);
  }
  return lines.join("\n");
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
