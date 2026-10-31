import type { Api } from "grammy";
import type { ChatPermissions } from "grammy/types";

/**
 * Member permissions for the assembly group. Telegram switches every member
 * permission ON when a group is created, which lets any member add people,
 * rename the group, pin messages and create topics. In an assembly those are
 * admin tasks, so the bot locks them: members talk, admins run the room.
 * Changing these needs the bot's "Ban users" (can_restrict_members) right.
 */
export const MEMBER_PERMISSIONS: ChatPermissions = {
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: true,
  can_send_video_notes: true,
  can_send_voice_notes: true,
  can_send_polls: false, // Telegram polls next to the real ballot only confuse
  can_send_other_messages: true,
  can_add_web_page_previews: true,
  can_change_info: false,
  can_invite_users: false,
  can_pin_messages: false,
  can_manage_topics: false,
};

/** The member switches the lock turns off; Setup reports which are still on. */
export const LOCKED_KEYS = ["can_invite_users", "can_change_info", "can_pin_messages", "can_manage_topics", "can_send_polls"] as const;
export type LockedKey = (typeof LOCKED_KEYS)[number];

export interface GroupLockState {
  locked: boolean;
  open: LockedKey[]; // admin-only switches members still have
}

export function lockState(perms: Partial<Record<string, unknown>> | undefined): GroupLockState {
  const open = LOCKED_KEYS.filter((k) => Boolean(perms?.[k]));
  return { locked: open.length === 0, open };
}

export type LockResult = { ok: true } | { ok: false; code: "no_rights" | "error"; reason: string };

export async function lockGroupPermissions(api: Api, chatId: number): Promise<LockResult> {
  try {
    await api.setChatPermissions(chatId, MEMBER_PERMISSIONS, { use_independent_chat_permissions: true });
    return { ok: true };
  } catch (err) {
    const reason = (err as Error).message ?? String(err);
    const code = /rights|CHAT_ADMIN_REQUIRED|administrator|not enough/i.test(reason) ? "no_rights" : "error";
    return { ok: false, code, reason };
  }
}

/** Current member permissions of a chat, or null when Telegram cannot be asked. */
export async function readLockState(api: Api, chatId: number): Promise<GroupLockState | null> {
  try {
    const chat = (await api.getChat(chatId)) as unknown as { permissions?: Record<string, unknown> };
    return lockState(chat.permissions);
  } catch {
    return null;
  }
}
