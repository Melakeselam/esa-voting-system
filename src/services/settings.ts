import { supabase } from "../db.js";

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

export async function getLinkedGroup(): Promise<LinkedGroup | null> {
  return getSetting<LinkedGroup>("group");
}

export interface ChatTopic {
  chat_id: number;
  thread_id: number; // 0 = General
  name: string | null;
  chat_title: string | null;
  updated_at: string;
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

/**
 * Forget the linked group and every topic learned in it — used when the bot
 * is removed from the group, or when an admin unlinks it in Setup. With a
 * chatId, only acts when that chat is the linked one.
 */
export async function unlinkGroup(chatId?: number): Promise<void> {
  const linked = await getLinkedGroup();
  if (chatId !== undefined && linked && linked.chat_id !== chatId) return;
  const id = chatId ?? linked?.chat_id;
  if (linked) await deleteSetting("group");
  if (id !== undefined) {
    const { error } = await supabase.from("chat_topics").delete().eq("chat_id", id);
    if (error) throw error;
  }
}
