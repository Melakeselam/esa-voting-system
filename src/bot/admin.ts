import { Composer, InputFile } from "grammy";
import type { Context } from "grammy";
import { audit } from "../db.js";
import { emailConfigured } from "../config.js";
import { isAdminUser } from "../services/admins.js";
import { buildReport, emailReport, reportToCsv, reportToHtml } from "../report.js";
import { formatLocal, parseDeadline } from "../time.js";
import { closeResolution } from "./lifecycle.js";
import { listRegisteredTelegramIds, memberCounts, unbindByToken } from "../services/members.js";
import {
  createResolution,
  getByCode,
  listResolutions,
  setAnnounceTarget,
  setAnonymous,
  setQuorum,
  eligibleFor,
  setStatus,
  setThreshold,
} from "../services/resolutions.js";
import { thresholdLabel } from "../verdict.js";
import { ballotCount, tally } from "../services/votes.js";
import { announceKeyboard, appKeyboard, escapeHtml, resolutionCard, resultsText } from "./ui.js";
import type { Resolution } from "../types.js";

export const adminComposer = new Composer<Context>();

// Everything below is admin-only.
const admin = adminComposer.filter((ctx) => isAdminUser(ctx.from?.id));

const ADMIN_HELP =
  "🛠 <b>Admin commands</b> (the Mini App does all of this with buttons: send /admin)\n\n" +
  "<code>/newres Title | Description | Option 1 | Option 2 [| ...]</code>\n" +
  "Create a resolution (use <code>-</code> for no description). Secret ballot by default.\n\n" +
  "/listres — list all resolutions\n" +
  "<code>/secret R1 on|off</code> — toggle secret ballot (draft only)\n" +
  "<code>/quorum R1 50</code> — % of eligible members who must cast a ballot for a valid result; <code>/quorum R1 off</code> removes it (draft only)\n" +
  "<code>/threshold R1 simple|2/3</code> — majority required to adopt (draft only). " +
  "Options named “Abstain” count toward quorum but not the majority.\n" +
  "<code>/open R1</code> — open voting (close manually with /close)\n" +
  "<code>/open R1 until 17:00</code> — open with an auto-close deadline\n" +
  "<code>/open R1 until 2026-08-14 17:00</code> · <code>/open R1 for 90m</code>\n" +
  "<code>/close R1</code> — close voting now and publish results\n" +
  "<code>/announce R1</code> — post the resolution here (run inside the assembly topic)\n" +
  "<code>/results R1</code> — show tally (interim or final)\n" +
  "/report — full assembly report as CSV + HTML files\n" +
  "<code>/report email</code> — also email it to the designated address\n" +
  "/stats — registration and voting statistics\n" +
  "<code>/broadcast message</code> — DM all registered members\n" +
  "<code>/unbind ESA-2026-XXXXX</code> — detach a token from its Telegram account";

async function requireResolution(ctx: Context, arg: string): Promise<Resolution | null> {
  const code = arg.trim().split(/\s+/)[0];
  if (!code) {
    await ctx.reply("Please give a resolution code, e.g. <code>/results R1</code>", { parse_mode: "HTML" });
    return null;
  }
  const res = await getByCode(code);
  if (!res) await ctx.reply(`No resolution with code <code>${escapeHtml(code)}</code>. See /listres`, { parse_mode: "HTML" });
  return res;
}

admin.command("admin", async (ctx) => {
  const kb = appKeyboard("🛠 Open admin panel");
  if (!kb || ctx.match.trim().toLowerCase() === "help" || ctx.chat?.type !== "private") {
    await ctx.reply(ADMIN_HELP, { parse_mode: "HTML" });
    return;
  }
  await ctx.reply(
    "🛠 <b>Admin panel</b>\n\n" +
      "Everything — resolutions, members, announcements, reports and setup — is managed in the app. " +
      "Tap the button below or use the menu button next to the message box.\n\n" +
      "Prefer typing? Send <code>/admin help</code> for the command list.",
    { parse_mode: "HTML", reply_markup: kb },
  );
});

admin.command("commands", (ctx) => ctx.reply(ADMIN_HELP, { parse_mode: "HTML" }));

admin.command("newres", async (ctx) => {
  const parts = ctx.match.split("|").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length < 4) {
    await ctx.reply(
      "Format: <code>/newres Title | Description | Option 1 | Option 2</code>\n" +
        "Use <code>-</code> as the description to leave it empty. At least two options are required.",
      { parse_mode: "HTML" },
    );
    return;
  }
  const [title, description, ...options] = parts;
  const res = await createResolution({
    title,
    description: description === "-" ? null : description,
    options,
  });
  await audit(ctx.from!.id, "resolution_created", { code: res.code, title });
  await ctx.reply(
    `✅ Created <b>${res.code}</b> (draft, secret ballot).\n\n` +
      `${resolutionCard(res)}\n\n` +
      `Next: optionally <code>/quorum ${res.code} 50</code> (percent of members) and <code>/threshold ${res.code} 2/3</code> ` +
      `(defaults: no quorum, simple majority), <code>/secret ${res.code} off</code> for an open ballot, ` +
      `then <code>/open ${res.code}</code> and <code>/announce ${res.code}</code> in the assembly topic.`,
    { parse_mode: "HTML" },
  );
});

admin.command("listres", async (ctx) => {
  const all = await listResolutions();
  if (all.length === 0) {
    await ctx.reply("No resolutions yet. Create one with /newres");
    return;
  }
  const lines = all.map((r) => {
    const state = r.status === "open" ? "🟢 open" : r.status === "closed" ? "🔴 closed" : "⚪ draft";
    return `<b>${escapeHtml(r.code)}</b> — ${escapeHtml(r.title)} (${state}, ${r.anonymous ? "secret" : "open ballot"}, ${r.options.length} options)`;
  });
  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
});

admin.command("secret", async (ctx) => {
  const [code, mode] = ctx.match.trim().split(/\s+/);
  if (!code || !["on", "off"].includes(mode)) {
    await ctx.reply("Format: <code>/secret R1 on</code> or <code>/secret R1 off</code>", { parse_mode: "HTML" });
    return;
  }
  const res = await requireResolution(ctx, code);
  if (!res) return;
  if (res.status !== "draft") {
    await ctx.reply("The ballot type can only be changed while the resolution is a draft.");
    return;
  }
  await setAnonymous(res.id, mode === "on");
  await ctx.reply(`✅ ${res.code} is now a ${mode === "on" ? "🔒 secret" : "✏️ open"} ballot.`);
});

admin.command("quorum", async (ctx) => {
  const [code, value] = ctx.match.trim().split(/\s+/);
  if (!code || !value) {
    await ctx.reply("Format: <code>/quorum R1 50</code> (percent of eligible members) or <code>/quorum R1 off</code>", { parse_mode: "HTML" });
    return;
  }
  const res = await requireResolution(ctx, code);
  if (!res) return;
  if (res.status !== "draft") {
    await ctx.reply("The quorum can only be changed while the resolution is a draft.");
    return;
  }
  if (value.toLowerCase() === "off") {
    await setQuorum(res.id, null);
    await audit(ctx.from!.id, "quorum_set", { code: res.code, quorum: null });
    await ctx.reply(`✅ ${res.code}: quorum requirement removed.`);
    return;
  }
  const quorum = Number(value);
  if (!Number.isInteger(quorum) || quorum < 1 || quorum > 100) {
    await ctx.reply("Quorum is a percentage from 1 to 100, e.g. <code>/quorum R1 50</code>", { parse_mode: "HTML" });
    return;
  }
  await setQuorum(res.id, quorum);
  await audit(ctx.from!.id, "quorum_set", { code: res.code, quorum });
  await ctx.reply(
    `✅ ${res.code}: ballots from at least <b>${quorum}%</b> of eligible members are needed for a valid result. ` +
      `The member count is taken when voting closes.`,
    { parse_mode: "HTML" },
  );
});

admin.command("threshold", async (ctx) => {
  const [code, raw] = ctx.match.trim().split(/\s+/);
  const mode =
    raw === "simple" ? "simple"
    : ["2/3", "two_thirds", "two-thirds", "twothirds"].includes(raw?.toLowerCase() ?? "") ? "two_thirds"
    : null;
  if (!code || !mode) {
    await ctx.reply("Format: <code>/threshold R1 simple</code> or <code>/threshold R1 2/3</code>", { parse_mode: "HTML" });
    return;
  }
  const res = await requireResolution(ctx, code);
  if (!res) return;
  if (res.status !== "draft") {
    await ctx.reply("The threshold can only be changed while the resolution is a draft.");
    return;
  }
  await setThreshold(res.id, mode);
  await audit(ctx.from!.id, "threshold_set", { code: res.code, threshold: mode });
  await ctx.reply(
    `✅ ${res.code}: adoption now requires a <b>${thresholdLabel(mode)}</b> of votes cast (abstentions excluded).`,
    { parse_mode: "HTML" },
  );
});

admin.command("open", async (ctx) => {
  const input = ctx.match.trim();
  const [codeArg] = input.split(/\s+/);
  const res = await requireResolution(ctx, codeArg ?? "");
  if (!res) return;
  if (res.status === "closed") {
    await ctx.reply(`${res.code} is closed and cannot be reopened. Create a new resolution instead.`);
    return;
  }

  const deadlineText = input.slice(codeArg.length).trim();
  const parsed = parseDeadline(deadlineText);
  if (parsed && "error" in parsed) {
    await ctx.reply(parsed.error);
    return;
  }
  const closesAt = parsed?.date ?? null;

  await setStatus(res.id, "open", closesAt);
  await audit(ctx.from!.id, "resolution_opened", {
    code: res.code,
    closes_at: closesAt?.toISOString() ?? null,
  });
  await ctx.reply(
    `🟢 Voting on <b>${res.code}</b> is now OPEN` +
      (closesAt
        ? `, closing automatically at <b>${formatLocal(closesAt)}</b> (use /close to end earlier).\n`
        : ` — close it manually with <code>/close ${res.code}</code>.\n`) +
      `Post it to the assembly with <code>/announce ${res.code}</code> in the right topic, ` +
      `and optionally notify all members with <code>/broadcast ...</code>`,
    { parse_mode: "HTML" },
  );
});

admin.command("close", async (ctx) => {
  const res = await requireResolution(ctx, ctx.match);
  if (!res) return;
  if (res.status !== "open") {
    await ctx.reply(`${res.code} is not open.`);
    return;
  }
  const text = await closeResolution(ctx.api, res, ctx.from!.id);
  if (!text) {
    await ctx.reply(`${res.code} was already closed.`);
    return;
  }
  await ctx.reply(`🔴 Voting on <b>${res.code}</b> is closed.\n\n${text}`, { parse_mode: "HTML" });
});

admin.command("report", async (ctx) => {
  const wantEmail = ctx.match.trim().toLowerCase() === "email";
  if (wantEmail && !emailConfigured()) {
    await ctx.reply(
      "Email delivery is not configured. Set RESEND_API_KEY, REPORT_EMAIL_FROM and " +
        "REPORT_EMAIL_TO in the environment, or use /report to receive the files here.",
    );
    return;
  }

  await ctx.reply("📋 Generating the assembly report…");
  const report = await buildReport();
  const csv = reportToCsv(report);
  const html = reportToHtml(report);
  const stamp = formatLocal(report.generatedAt).replace(/[: ]/g, "-");

  await ctx.replyWithDocument(
    new InputFile(Buffer.from(csv, "utf8"), `esa-voting-report-${stamp}.csv`),
    { caption: "Raw data — opens in Excel / Google Sheets." },
  );
  await ctx.replyWithDocument(
    new InputFile(Buffer.from(html, "utf8"), `esa-voting-report-${stamp}.html`),
    { caption: "Formatted report — open in a browser, print to PDF if needed." },
  );

  if (wantEmail) {
    try {
      const to = await emailReport(html, csv);
      await ctx.reply(`📧 Report emailed to ${to}.`);
    } catch (err) {
      console.error("report email failed:", err);
      await ctx.reply("⚠️ Email delivery failed — check the server logs. The files above are still valid.");
    }
  }
  await audit(ctx.from!.id, "report_generated", { emailed: wantEmail });
});

admin.command("announce", async (ctx) => {
  const res = await requireResolution(ctx, ctx.match);
  if (!res) return;
  const threadId = ctx.message?.message_thread_id ?? null;
  await ctx.api.sendMessage(ctx.chat!.id, resolutionCard(res), {
    parse_mode: "HTML",
    message_thread_id: threadId ?? undefined,
    reply_markup: announceKeyboard(res, ctx.me.username),
  });
  await setAnnounceTarget(res.id, ctx.chat!.id, threadId);
  // Clean up the command message in group chats to keep the topic tidy.
  if (ctx.chat!.type !== "private") {
    try {
      await ctx.deleteMessage();
    } catch {
      // Bot may lack delete rights; harmless.
    }
  }
});

admin.command("results", async (ctx) => {
  const res = await requireResolution(ctx, ctx.match);
  if (!res) return;
  const [rows, ballots, eligible] = await Promise.all([tally(res.id), ballotCount(res.id), eligibleFor(res)]);
  await ctx.reply(resultsText(res, rows, ballots, eligible), { parse_mode: "HTML" });
});

admin.command("stats", async (ctx) => {
  const counts = await memberCounts();
  const all = await listResolutions();
  const lines = [
    "📈 <b>System statistics</b>",
    `Members: ${counts.registered} registered of ${counts.total} issued tokens`,
    "",
  ];
  for (const res of all) {
    const ballots = await ballotCount(res.id);
    const turnout = counts.registered === 0 ? 0 : Math.round((ballots / counts.registered) * 100);
    lines.push(`${escapeHtml(res.code)} (${res.status}): ${ballots} ballots — ${turnout}% of registered`);
  }
  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
});

admin.command("broadcast", async (ctx) => {
  const text = ctx.match.trim();
  if (!text) {
    await ctx.reply("Format: <code>/broadcast Your message here</code>", { parse_mode: "HTML" });
    return;
  }
  const ids = await listRegisteredTelegramIds();
  await ctx.reply(`📣 Sending to ${ids.length} registered members…`);
  let sent = 0;
  for (const id of ids) {
    try {
      await ctx.api.sendMessage(id, `📣 ${text}`);
      sent++;
    } catch {
      // Member may have blocked the bot; skip.
    }
    // Stay well under Telegram's ~30 messages/second limit.
    await new Promise((r) => setTimeout(r, 40));
  }
  await audit(ctx.from!.id, "broadcast", { sent, total: ids.length });
  await ctx.reply(`✅ Broadcast delivered to ${sent}/${ids.length} members.`);
});

admin.command("unbind", async (ctx) => {
  const token = ctx.match.trim();
  if (!token) {
    await ctx.reply("Format: <code>/unbind ESA-2026-XXXXX</code>", { parse_mode: "HTML" });
    return;
  }
  const ok = await unbindByToken(token);
  await audit(ctx.from!.id, "unbind", { token, ok });
  await ctx.reply(ok ? `✅ Token detached. The member can register again with /start.` : "Token not found.");
});
