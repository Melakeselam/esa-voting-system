import bcrypt from "bcryptjs";
import { audit, supabase } from "../db.js";
import { config } from "../config.js";
import type { Member } from "../types.js";

export function normalizeToken(raw: string): string {
  return raw.trim().toUpperCase();
}

export async function findByToken(token: string): Promise<Member | null> {
  const { data, error } = await supabase
    .from("members")
    .select("*")
    .eq("token_id", normalizeToken(token))
    .maybeSingle();
  if (error) throw error;
  return data as Member | null;
}

export async function findById(id: string): Promise<Member | null> {
  const { data, error } = await supabase.from("members").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Member | null;
}

export async function findByTelegramId(telegramId: number): Promise<Member | null> {
  const { data, error } = await supabase
    .from("members")
    .select("*")
    .eq("telegram_user_id", telegramId)
    .maybeSingle();
  if (error) throw error;
  return data as Member | null;
}

export function isLocked(member: Member): boolean {
  return member.locked_until !== null && new Date(member.locked_until) > new Date();
}

export async function verifyPassword(member: Member, password: string): Promise<boolean> {
  return bcrypt.compare(password, member.password_hash);
}

/** Increment failed attempts; lock the token after too many. Returns true if now locked. */
export async function recordFailedAttempt(member: Member): Promise<boolean> {
  const attempts = member.failed_attempts + 1;
  const lock = attempts >= config.maxLoginAttempts;
  const { error } = await supabase
    .from("members")
    .update({
      failed_attempts: lock ? 0 : attempts,
      locked_until: lock ? new Date(Date.now() + config.lockMinutes * 60_000).toISOString() : null,
    })
    .eq("id", member.id);
  if (error) throw error;
  return lock;
}

export async function bindTelegram(memberId: string, telegramId: number): Promise<void> {
  const { error } = await supabase
    .from("members")
    .update({
      telegram_user_id: telegramId,
      registered_at: new Date().toISOString(),
      failed_attempts: 0,
      locked_until: null,
    })
    .eq("id", memberId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Login (shared by the chat flow and the Mini App)
// ---------------------------------------------------------------------------

export type TokenCheck =
  | { status: "ok"; member: Member }
  | { status: "unknown_token" | "conflict" | "locked" };

export type LoginResult =
  | { status: "ok"; member: Member }
  | { status: "unknown_token" | "conflict" | "locked" | "wrong_password" | "locked_now" };

/** Step 1: is this token usable by this Telegram account? */
export async function checkToken(token: string, telegramId: number): Promise<TokenCheck> {
  const member = await findByToken(token);
  if (!member || !member.is_active) return { status: "unknown_token" };
  if (member.telegram_user_id !== null && member.telegram_user_id !== telegramId) {
    await audit(telegramId, "login_token_conflict", { token: member.token_id });
    return { status: "conflict" };
  }
  if (isLocked(member)) return { status: "locked" };
  return { status: "ok", member };
}

/** Step 2: verify the password and bind the Telegram account. Re-reads the member first. */
export async function verifyAndBind(member: Member, password: string, telegramId: number): Promise<LoginResult> {
  const fresh = await findByToken(member.token_id);
  if (!fresh || !fresh.is_active) return { status: "unknown_token" };
  if (isLocked(fresh)) return { status: "locked" };
  if (fresh.telegram_user_id !== null && fresh.telegram_user_id !== telegramId) return { status: "conflict" };

  if (!(await verifyPassword(fresh, password))) {
    const locked = await recordFailedAttempt(fresh);
    await audit(telegramId, "login_failed", { token: fresh.token_id });
    return { status: locked ? "locked_now" : "wrong_password" };
  }

  await bindTelegram(fresh.id, telegramId);
  await audit(telegramId, "login_success", { token: fresh.token_id });
  return { status: "ok", member: { ...fresh, telegram_user_id: telegramId } };
}

/** One-shot login used by the Mini App registration form. */
export async function loginWithCredentials(token: string, password: string, telegramId: number): Promise<LoginResult> {
  const check = await checkToken(token, telegramId);
  if (check.status !== "ok") return check;
  return verifyAndBind(check.member, password, telegramId);
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export async function unbindByToken(token: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("members")
    .update({ telegram_user_id: null, registered_at: null })
    .eq("token_id", normalizeToken(token))
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function unbindById(id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("members")
    .update({ telegram_user_id: null, registered_at: null })
    .eq("id", id)
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function setMemberActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from("members").update({ is_active: active }).eq("id", id);
  if (error) throw error;
}

export async function unlockMember(id: string): Promise<void> {
  const { error } = await supabase
    .from("members")
    .update({ locked_until: null, failed_attempts: 0 })
    .eq("id", id);
  if (error) throw error;
}

export type MemberListItem = Omit<Member, "password_hash">;
export type MemberFilter = "all" | "registered" | "unregistered" | "locked" | "inactive";

export async function listMembers(opts: {
  q?: string;
  filter?: MemberFilter;
  page?: number;
  pageSize?: number;
}): Promise<{ items: MemberListItem[]; total: number }> {
  const page = Math.max(0, opts.page ?? 0);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
  let query = supabase
    .from("members")
    .select("id, token_id, full_name, region, telegram_user_id, registered_at, failed_attempts, locked_until, is_active", {
      count: "exact",
    });

  const q = (opts.q ?? "").trim().replace(/[,()%]/g, "");
  if (q) query = query.or(`token_id.ilike.%${q}%,full_name.ilike.%${q}%,region.ilike.%${q}%`);

  switch (opts.filter) {
    case "registered":
      query = query.not("telegram_user_id", "is", null);
      break;
    case "unregistered":
      query = query.is("telegram_user_id", null).eq("is_active", true);
      break;
    case "locked":
      query = query.gt("locked_until", new Date().toISOString());
      break;
    case "inactive":
      query = query.eq("is_active", false);
      break;
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: true })
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw error;
  return { items: (data ?? []) as MemberListItem[], total: count ?? 0 };
}

/** Telegram IDs of all registered, active members, in a stable order (paginated past the 1000-row limit). */
export async function listRegisteredTelegramIds(): Promise<number[]> {
  const ids: number[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("members")
      .select("telegram_user_id")
      .not("telegram_user_id", "is", null)
      .eq("is_active", true)
      .order("telegram_user_id", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw error;
    for (const row of data) ids.push(row.telegram_user_id as number);
    if (data.length < page) break;
  }
  return ids;
}

export async function memberCounts(): Promise<{ total: number; registered: number; active: number }> {
  const [total, registered, active] = await Promise.all([
    supabase.from("members").select("*", { count: "exact", head: true }),
    supabase.from("members").select("*", { count: "exact", head: true }).not("telegram_user_id", "is", null),
    supabase.from("members").select("*", { count: "exact", head: true }).eq("is_active", true),
  ]);
  if (total.error) throw total.error;
  if (registered.error) throw registered.error;
  if (active.error) throw active.error;
  return { total: total.count ?? 0, registered: registered.count ?? 0, active: active.count ?? 0 };
}
