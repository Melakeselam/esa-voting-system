import { InlineKeyboard } from "grammy";
import type { Api } from "grammy";
import { appUrl } from "../config.js";
import { getLinkedGroup, getSetting, setSetting } from "../services/settings.js";

interface GroupLink {
  chat_id: number;
  link: string;
}

/**
 * A link members can tap to open the assembly group after registering. A
 * public group is linked by username; otherwise the bot creates one invite
 * link that works through join requests (needs the "Invite users" right), so
 * the group gate approves registered members at once. Cached in app_settings.
 */
export async function groupInviteLink(api: Api): Promise<string | null> {
  const linked = await getLinkedGroup();
  if (!linked) return null;
  const saved = await getSetting<GroupLink>("group_link");
  if (saved && saved.chat_id === linked.chat_id) return saved.link;
  try {
    const chat = (await api.getChat(linked.chat_id)) as unknown as { username?: string };
    let link: string;
    if (chat.username) {
      link = `https://t.me/${chat.username}`;
    } else {
      const invite = await api.createChatInviteLink(linked.chat_id, { name: "ESA Voting — registered members", creates_join_request: true });
      link = invite.invite_link;
    }
    await setSetting("group_link", { chat_id: linked.chat_id, link } satisfies GroupLink);
    return link;
  } catch (err) {
    console.error("could not get a link to the assembly group:", (err as Error).message);
    return null;
  }
}

/** Buttons after a successful registration: into the group, and into the app. */
export async function afterRegistrationKeyboard(api: Api): Promise<InlineKeyboard | undefined> {
  const kb = new InlineKeyboard();
  const link = await groupInviteLink(api);
  if (link) kb.url("👥 Open the assembly group", link).row();
  const url = appUrl();
  if (url) kb.webApp("🗳 Open voting app", url);
  return link || url ? kb : undefined;
}
