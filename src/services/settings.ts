import { supabase } from "../db.js";
import { currentOrg, setOrgGroup } from "./orgs.js";

/** Small key/value store for app-level configuration (e.g. the linked group). */
export async function getSetting<T>(key: string): Promise<T | null> {
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return (data?.value as T | undefined) ?? null;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
}

export interface LinkedGroup {
  chat_id: number;
  title: string | null;
}

/** The current organisation's linked Telegram group (stored on the organisation row). */
export async function getLinkedGroup(): Promise<LinkedGroup | null> {
  const org = await currentOrg();
  return org?.group_chat_id ? { chat_id: Number(org.group_chat_id), title: org.group_title } : null;
}

export async function setLinkedGroup(chatId: number, title: string | null): Promise<void> {
  await setOrgGroup(chatId, title);
}

export interface ChatTopic {
  chat_id: number;
  thread_id: number; // 0 = General
  name: string | null;
  chat_title: string | null;
  updated_at: string;
  read_only?: boolean; // only admins post (the topic is closed in Telegram)
  keyboard_message_id?: number | null; // the "⌨️" message carrying the buttons
  panel_message_id?: number | null; // the pinned button panel of a read-only topic
}

/**
 * Record a topic the bot has seen. Only overwrites the name when one is given,
 * so a topic learned from a plain message keeps a name learned earlier.
 */
export async function upsertTopic(topic: {
  chat_id: number;
  thread_id: number;
  name?: string | null;
  chat_title?: string | null;
}): Promise<void> {
  const row: Record<string, unknown> = {
    chat_id: topic.chat_id,
    thread_id: topic.thread_id,
    updated_at: new Date().toISOString(),
  };
  if (topic.name) row.name = topic.name;
  if (topic.chat_title) row.chat_title = topic.chat_title;
  const { error } = await supabase.from("chat_topics").upsert(row, { onConflict: "chat_id,thread_id" });
  if (error) throw error;
}

export async function listTopics(): Promise<ChatTopic[]> {
  const { data, error } = await supabase
    .from("chat_topics")
    .select("*")
    .order("thread_id", { ascending: true });
  if (error) throw error;
  return data as ChatTopic[];
}

export async function getTopic(chatId: number, threadId: number): Promise<ChatTopic | null> {
  const { data, error } = await supabase
    .from("chat_topics")
    .select("*")
    .eq("chat_id", chatId)
    .eq("thread_id", threadId)
    .maybeSingle();
  if (error) throw error;
  return data as ChatTopic | null;
}

export async function updateTopic(
  chatId: number,
  threadId: number,
  patch: Partial<Pick<ChatTopic, "read_only" | "keyboard_message_id" | "panel_message_id">>,
): Promise<void> {
  const { error } = await supabase.from("chat_topics").update(patch).eq("chat_id", chatId).eq("thread_id", threadId);
  if (error) throw error;
}

export async function renameTopic(chatId: number, threadId: number, name: string): Promise<void> {
  const { error } = await supabase
    .from("chat_topics")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("chat_id", chatId)
    .eq("thread_id", threadId);
  if (error) throw error;
}

export async function deleteTopic(chatId: number, threadId: number): Promise<void> {
  const { error } = await supabase.from("chat_topics").delete().eq("chat_id", chatId).eq("thread_id", threadId);
  if (error) throw error;
}

export async function deleteSetting(key: string): Promise<void> {
  const { error } = await supabase.from("app_settings").delete().eq("key", key);
  if (error) throw error;
}

/** What the bot posted in a group it was removed from, in case it is added back. */
export interface GroupMemory {
  chat_id: number;
  topics: { thread_id: number; keyboard_message_id?: number | null; panel_message_id?: number | null; read_only?: boolean }[];
}

/**
 * Forget the linked group and every topic learned in it — used when the bot
 * is removed from the group, or when an admin unlinks it in Setup. With a
 * chatId, only acts when that chat is the linked one.
 */
export async function unlinkGroup(chatId?: number): Promise<void> {
  const linked = await getLinkedGroup();
  if (chatId !== undefined && linked && linked.chat_id !== chatId) return;
  if (linked) await setOrgGroup(null, null);
  // The ids of the bot's own topics ("Register / Sign in", "Commands") and of
  // the live board are kept: they name their chat, so they are only used if
  // the bot comes back to that same group — which then gets its topics reused
  // instead of a second copy of each. The button messages posted in the
  // topics are remembered for the same reason, so they can be replaced.
  if (linked) {
    const { data: topics } = await supabase.from("chat_topics").select("thread_id, keyboard_message_id, panel_message_id, read_only").eq("chat_id", linked.chat_id);
    await setSetting("group_memory", { chat_id: linked.chat_id, topics: topics ?? [] } satisfies GroupMemory);
  }
  await deleteSetting("group_link");
  // Only one group is ever linked, so every learned topic goes — including
  // rows that were added by hand under a wrong chat id.
  const { error } = await supabase.from("chat_topics").delete().neq("thread_id", -1);
  if (error) throw error;
  // The people seen in that group go with it.
  const { error: peopleError } = await supabase.from("group_people").delete().neq("user_id", -1);
  if (peopleError) throw peopleError;
}
