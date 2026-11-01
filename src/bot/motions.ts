import { Composer, InlineKeyboard } from "grammy";
import type { Api, Context } from "grammy";
import { audit } from "../db.js";
import { findByTelegramId } from "../services/members.js";
import { getLang, inLang, isSignedIn } from "../services/presence.js";
import { getLinkedGroup } from "../services/settings.js";
import {
  cancelMotionVote,
  getMotion,
  reopenMotionVote,
  secondMotion,
  setCard,
  settleMotionVote,
} from "../services/motions.js";
import type { Motion } from "../types.js";
import { openLink } from "./group-commands.js";
import { notifyAdmins } from "./notify.js";
import { appKeyboard, escapeHtml } from "./ui.js";

/**
 * A motion in the group: a card posted in the topic it was moved in, with a
 * "Second this motion" button while it waits for a seconder. The card is
 * edited as the motion moves on (seconded, stated, put to the vote, decided),
 * so the topic always shows where it stands; members keep talking around it.
 */

const STATUS_LINE: Record<Motion["status"], [string, string]> = {
  proposed: ["⏳ Waiting for a seconder", "⏳ ደጋፊ እየጠበቀ ነው"],
  seconded: ["✋ Seconded — waiting for the chair", "✋ ተደግፏል — ሰብሳቢውን እየጠበቀ ነው"],
  stated: ["🧑‍⚖️ Stated by the chair — open for debate and amendments", "🧑‍⚖️ ሰብሳቢው አቅርበውታል — ለውይይትና ለማሻሻያ ክፍት ነው"],
  voting: ["🗳 Put to the vote", "🗳 ለድምፅ ቀርቧል"],
  adopted: ["✅ Adopted", "✅ ጸድቋል"],
  lost: ["❌ Lost", "❌ አልጸደቀም"],
  withdrawn: ["↩️ Withdrawn by the mover", "↩️ አቅራቢው አንስተውታል"],
  out_of_order: ["⛔ Ruled out of order", "⛔ ከሥነ ሥርዓት ውጭ ተብሏል"],
  merged: ["🔗 Merged into another motion", "🔗 ከሌላ ሀሳብ ጋር ተዋህዷል"],
  lapsed: ["💤 Lapsed — nobody seconded it", "💤 ደጋፊ ስላላገኘ ቀርቷል"],
};

const KIND_LABEL: Record<Motion["kind"], string> = {
  main: "Motion / ሀሳብ",
  constitutional: "⚖️ Constitutional motion / የሕገ ደንብ ሀሳብ",
  amendment: "✏️ Amendment / ማሻሻያ",
};

export function motionCard(m: Motion, parent: Motion | null, extra: { mergedInto?: string | null; resolutionCode?: string | null } = {}): string {
  const lines = [
    `📝 <b>${escapeHtml(m.code)}</b> · ${KIND_LABEL[m.kind]}`,
    `<b>${escapeHtml(m.title)}</b>`,
  ];
  if (parent) lines.push(`<i>Amends ${escapeHtml(parent.code)} — ${escapeHtml(parent.title)}</i>`);
  lines.push("", escapeHtml(m.body), "");
  lines.push(`🙋 Moved by / አቅራቢ: <b>${escapeHtml(m.mover_name ?? "—")}</b>${m.from_floor ? " (from the floor)" : ""}`);
  if (m.seconder_name) lines.push(`✋ Seconded by / ደጋፊ: <b>${escapeHtml(m.seconder_name)}</b>`);
  const [en, am] = STATUS_LINE[m.status];
  let status = `${en}\n${am}`;
  if (m.status === "voting" && extra.resolutionCode) status = `🗳 Put to the vote as ${escapeHtml(extra.resolutionCode)} — vote in the app\n🗳 ${escapeHtml(extra.resolutionCode)} ሆኖ ለድምፅ ቀርቧል`;
  if (m.status === "merged" && extra.mergedInto) status += ` → ${escapeHtml(extra.mergedInto)}`;
  lines.push("", status);
  if (m.reason && (m.status === "out_of_order" || m.status === "withdrawn" || m.status === "merged")) lines.push(`<i>${escapeHtml(m.reason)}</i>`);
  if (m.late_notice && (m.status === "proposed" || m.status === "seconded")) lines.push("⚠️ Moved after the notice deadline for constitutional motions.");
  return lines.join("\n");
}

function motionKeyboard(m: Motion, botUsername: string): InlineKeyboard | undefined {
  if (m.status === "proposed") return new InlineKeyboard().text("✋ Second this motion / ደግፍ", `ms|${m.id}`);
  if (m.status === "stated" && m.kind !== "amendment") return new InlineKeyboard().url("✏️ Propose an amendment / ማሻሻያ", openLink(botUsername, `amend_${m.id}`));
  if (m.status === "voting") return new InlineKeyboard().url("🗳 Vote / ድምፅ ይስጡ", openLink(botUsername, "vote"));
  return undefined;
}

async function cardExtras(m: Motion): Promise<{ parent: Motion | null; mergedInto: string | null; resolutionCode: string | null }> {
  const parent = m.parent_id ? await getMotion(m.parent_id) : null;
  const mergedInto = m.merged_into ? ((await getMotion(m.merged_into))?.code ?? null) : null;
  let resolutionCode: string | null = null;
  if (m.resolution_id) {
    const { getById } = await import("../services/resolutions.js");
    resolutionCode = (await getById(m.resolution_id))?.code ?? null;
  }
  return { parent, mergedInto, resolutionCode };
}

/** Post the card in the motion's topic (the linked group's General when it has none). Returns false when it could not be posted. */
export async function postMotionCard(api: Api, m: Motion): Promise<boolean> {
  const group = await getLinkedGroup();
  if (!group) return false;
  const chatId = m.chat_id && m.chat_id === group.chat_id ? m.chat_id : group.chat_id;
  const threadId = chatId === m.chat_id ? (m.thread_id ?? null) : null;
  const me = await api.getMe();
  const x = await cardExtras(m);
  const opts = { parse_mode: "HTML" as const, reply_markup: motionKeyboard(m, me.username), disable_notification: false };
  const parentCard = x.parent?.message_id && x.parent.chat_id === chatId ? x.parent.message_id : null;
  const send = (thread: number | null) =>
    api.sendMessage(chatId, motionCard(m, x.parent, x), {
      ...opts,
      message_thread_id: thread || undefined,
      ...(parentCard && thread === threadId ? { reply_parameters: { message_id: parentCard, allow_sending_without_reply: true } } : {}),
    });
  let msg;
  try {
    msg = await send(threadId);
  } catch (err) {
    // The topic was deleted or never existed: General instead.
    if (!threadId || !/thread not found|TOPIC_DELETED|TOPIC_ID_INVALID|TOPIC_CLOSED/i.test((err as Error).message)) throw err;
    msg = await send(null);
    await setCard(m.id, chatId, null, msg.message_id);
    return true;
  }
  await setCard(m.id, chatId, threadId, msg.message_id);
  return true;
}

/** Bring the card in the topic up to date with the motion's stage. */
export async function refreshMotionCard(api: Api, m: Motion): Promise<void> {
  if (!m.chat_id || !m.message_id) return;
  const me = await api.getMe();
  const x = await cardExtras(m);
  try {
    await api.editMessageText(m.chat_id, m.message_id, motionCard(m, x.parent, x), { parse_mode: "HTML", reply_markup: motionKeyboard(m, me.username) });
  } catch (err) {
    if (!/not modified/i.test((err as Error).message)) console.error(`motion ${m.code}: card update failed:`, (err as Error).message);
  }
}

/** A short note in the motion's topic, as a reply to its card (e.g. "the chair has stated M3"). */
export async function noteInTopic(api: Api, m: Motion, text: string): Promise<void> {
  if (!m.chat_id) return;
  try {
    await api.sendMessage(m.chat_id, text, {
      parse_mode: "HTML",
      message_thread_id: m.thread_id || undefined,
      ...(m.message_id ? { reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true } } : {}),
    });
  } catch (err) {
    console.error(`motion ${m.code}: note in topic failed:`, (err as Error).message);
  }
}

export async function tellAdminsSeconded(api: Api, m: Motion): Promise<void> {
  await notifyAdmins(
    api,
    `✋ <b>${escapeHtml(m.code)} — ${escapeHtml(m.title)}</b> was seconded by ${escapeHtml(m.seconder_name ?? "a member")} and is in the motions queue.`,
    appKeyboard("📝 Open the motions queue", "?view=motions"),
  );
}

// ---------------------------------------------------------------- the vote on a motion

/** Voting on a resolution closed: the motion it puts to the vote is adopted or lost. */
export async function afterMotionVote(api: Api, resolutionId: string, adopted: boolean): Promise<void> {
  for (const m of await settleMotionVote(resolutionId, adopted)) await refreshMotionCard(api, m);
}

export async function afterMotionVoteReopened(api: Api, resolutionId: string): Promise<void> {
  for (const m of await reopenMotionVote(resolutionId)) await refreshMotionCard(api, m);
}

export async function afterMotionVoteCancelled(api: Api, motionId: string): Promise<void> {
  const m = await cancelMotionVote(motionId);
  if (m) await refreshMotionCard(api, m);
}

// ---------------------------------------------------------------- "Second this motion"

export const motionsComposer = new Composer<Context>();

const SECOND_TEXT = {
  done: ["✋ You seconded {code}. It goes to the chair's queue.", "✋ {code}ን ደግፈዋል። ወደ ሰብሳቢው ወረፋ ይሄዳል።"],
  register: ["Only registered members can second a motion.", "ሀሳብን መደገፍ የሚችሉት የተመዘገቡ አባላት ብቻ ናቸው።"],
  out: ["You are signed out. Sign in first.", "ከስብሰባው ወጥተዋል። መጀመሪያ ይግቡ።"],
  own: ["You moved this motion; another member must second it.", "ይህን ሀሳብ ያቀረቡት እርስዎ ነዎት፤ ሌላ አባል መደገፍ አለበት።"],
  council: ["The seconder must come from another council than the mover.", "ደጋፊው ከአቅራቢው የተለየ ምክር ቤት መሆን አለበት።"],
  taken: ["This motion is no longer waiting for a seconder.", "ይህ ሀሳብ ደጋፊ መጠበቅ አቁሟል።"],
} as const;

motionsComposer.callbackQuery(/^ms\|([0-9a-f-]{36})$/, async (ctx) => {
  const lang = await getLang(ctx.from.id);
  const say = (k: keyof typeof SECOND_TEXT, code = "") => inLang(lang, SECOND_TEXT[k][0], SECOND_TEXT[k][1]).replace("{code}", code).slice(0, 200);
  const member = await findByTelegramId(ctx.from.id);
  if (!member || !member.is_active) return void (await ctx.answerCallbackQuery({ text: say("register"), show_alert: true }));
  if (!isSignedIn(member)) return void (await ctx.answerCallbackQuery({ text: say("out"), show_alert: true }));
  const r = await secondMotion(ctx.match[1], member);
  if ("refused" in r) {
    const key = r.refused === "own_motion" ? "own" : r.refused === "same_council" ? "council" : "taken";
    return void (await ctx.answerCallbackQuery({ text: say(key), show_alert: true }));
  }
  await audit(ctx.from.id, "motion_seconded", { code: r.motion.code, via: "group" });
  await ctx.answerCallbackQuery({ text: say("done", r.motion.code) });
  await refreshMotionCard(ctx.api, r.motion);
  await tellAdminsSeconded(ctx.api, r.motion);
});
