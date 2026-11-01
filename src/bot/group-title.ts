import type { Api } from "grammy";
import { currentOrg, PLATFORM_NAME } from "../services/orgs.js";
import { setLinkedGroup } from "../services/settings.js";

/** Telegram's limit for a group title. */
const MAX_TITLE = 128;
const SEPARATOR = " | ";

/** The group's own name, without a "| Organisation (Kene Voting System)" label added earlier. */
export function baseTitle(title: string): string {
  const at = title.lastIndexOf(SEPARATOR);
  if (at > 0 && title.endsWith(`(${PLATFORM_NAME})`)) return title.slice(0, at).trim();
  if (title.trim() === PLATFORM_NAME) return "";
  return title.trim();
}

/**
 * "Group name | Organisation (Kene Voting System)". Falls back to the short
 * code, then shortens the group's own name, to stay within Telegram's limit.
 */
export function brandedTitle(title: string | null, org: { name_en: string; short_code: string }): string {
  const base = baseTitle(title ?? "");
  const labels = [`${org.name_en} (${PLATFORM_NAME})`, `${org.short_code} (${PLATFORM_NAME})`];
  for (const label of labels) {
    const full = base ? `${base}${SEPARATOR}${label}` : label;
    if (full.length <= MAX_TITLE) return full;
  }
  const label = labels[1];
  const room = MAX_TITLE - label.length - SEPARATOR.length - 1;
  return `${base.slice(0, Math.max(0, room)).trimEnd()}…${SEPARATOR}${label}`;
}

export interface TitleResult {
  title: string | null;
  note: string | null;
}

/**
 * Add the organisation's name and the platform name to the group's title, so
 * members see which assembly the group is for. Needs the bot's "Change group
 * info" right; without it the title stays and the admins get a note.
 */
export async function brandGroupTitle(api: Api, chatId: number, title: string | null): Promise<TitleResult> {
  const org = await currentOrg();
  if (!org) return { title, note: null };
  const wanted = brandedTitle(title, org);
  if (wanted === title) return { title, note: null };
  try {
    await api.setChatTitle(chatId, wanted);
  } catch (err) {
    return {
      title,
      note: `Could not rename the group to “${wanted}” (${(err as Error).message}). Give me the “Change group info” right, or rename it yourself.`,
    };
  }
  await setLinkedGroup(chatId, wanted);
  console.log(`Renamed group ${chatId} to "${wanted}"`);
  return { title: wanted, note: null };
}
