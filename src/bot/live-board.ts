import { InlineKeyboard } from "grammy";
import type { Api } from "grammy";
import { config } from "../config.js";
import { withOrg } from "../org-context.js";
import { getLinkedGroup, getSetting, setSetting } from "../services/settings.js";
import { orgWords } from "../services/orgs.js";
import { onLiveChange, presenceCounts } from "../services/presence.js";
import { listResolutions } from "../services/resolutions.js";
import { ballotCount } from "../services/votes.js";
import { formatLocal } from "../time.js";
import { escapeHtml } from "./ui.js";

/**
 * The "📊 Live" message pinned in General: who is signed in (available or
 * stepped away) and which votes are open with how many ballots so far. The
 * bot edits it a few seconds after anything it shows changes, so a burst of
 * ballots costs one edit.
 */
interface LiveBoard {
  chat_id: number;
  message_id: number;
}

async function boardText(): Promise<string> {
  const [w, p, open] = await Promise.all([orgWords(), presenceCounts(), listResolutions("open")]);
  const lines = [
    `📊 <b>Live — ${escapeHtml(w.branded)}</b>`,
    `🙋 Signed in / ገብተዋል: <b>${p.signed_in}</b> of ${p.registered}`,
    `   🟢 available / አሉ ${p.available} · ☕ stepped away / ወጣ ብለዋል ${p.away}`,
    `🗳 Open votes / ክፍት ድምፆች: <b>${open.length}</b>`,
  ];
  for (const r of open) lines.push(`   • ${escapeHtml(r.code)} — ${escapeHtml(r.title)}: ${await ballotCount(r.id)} ballots / ድምፆች`);
  lines.push("", `<i>Updated / የዘመነው ${escapeHtml(formatLocal(new Date()))}</i>`);
  return lines.join("\n");
}

function boardKeyboard(botUsername: string): InlineKeyboard {
  const vote = config.miniAppShortName
    ? `https://t.me/${botUsername}/${config.miniAppShortName}?startapp=vote`
    : `https://t.me/${botUsername}?start=vote`;
  return new InlineKeyboard().url("🗳 Vote", vote).text("🙋 Sign in", "pr|in").text("🚪 Logout", "pr|out");
}

/** Post (or re-post) the board in General and pin it. */
export async function ensureLiveBoard(api: Api, chatId: number, opts: { repost?: boolean } = {}): Promise<void> {
  const saved = await getSetting<LiveBoard>("live_board");
  if (saved && saved.chat_id === chatId && !opts.repost) {
    await refreshLiveBoard(api);
    return;
  }
  const me = await api.getMe();
  const msg = await api.sendMessage(chatId, await boardText(), { parse_mode: "HTML", reply_markup: boardKeyboard(me.username), disable_notification: true });
  if (saved?.chat_id === chatId) await api.deleteMessage(chatId, saved.message_id).catch(() => undefined);
  try {
    await api.pinChatMessage(chatId, msg.message_id, { disable_notification: true });
  } catch {
    // Unpinned still works.
  }
  await setSetting("live_board", { chat_id: chatId, message_id: msg.message_id } satisfies LiveBoard);
}

/** Bring the pinned board up to date (re-post it if someone deleted it). */
export async function refreshLiveBoard(api: Api): Promise<void> {
  const group = await getLinkedGroup();
  const saved = await getSetting<LiveBoard>("live_board");
  if (!group || !saved || saved.chat_id !== group.chat_id) return;
  const me = await api.getMe();
  try {
    await api.editMessageText(saved.chat_id, saved.message_id, await boardText(), { parse_mode: "HTML", reply_markup: boardKeyboard(me.username) });
  } catch (err) {
    const msg = (err as Error).message;
    if (/not modified/i.test(msg)) return;
    if (/not found|can't be edited/i.test(msg)) await ensureLiveBoard(api, group.chat_id, { repost: true });
    else throw err;
  }
}

const DEBOUNCE_MS = 4_000;
const pending = new Map<string, NodeJS.Timeout>();

/** Refresh the board of each organisation a few seconds after its last change. */
export function watchLiveChanges(api: Api): void {
  onLiveChange((orgId) => {
    clearTimeout(pending.get(orgId));
    const timer = setTimeout(() => {
      pending.delete(orgId);
      withOrg(orgId, () => refreshLiveBoard(api)).catch((err) => console.error("live board refresh failed:", (err as Error).message));
    }, DEBOUNCE_MS);
    timer.unref?.();
    pending.set(orgId, timer);
  });
}
