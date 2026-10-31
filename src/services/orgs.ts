import { rawDb } from "../db.js";
import { config } from "../config.js";
import { currentOrgId, requireOrgId } from "../org-context.js";

/**
 * Organisations served by Kene Voting System. Each one has its own members,
 * councils, resolutions, admins and Telegram group; this module is the only
 * place that reads across organisations (with rawDb).
 */
export interface Org {
  id: string;
  name_en: string;
  name_am: string | null;
  short_code: string;
  assembly_en: string | null;
  assembly_am: string | null;
  office_en: string | null;
  office_am: string | null;
  voter_term: string;
  group_term: string;
  group_chat_id: number | null;
  group_title: string | null;
  created_at: string;
}

export const PLATFORM_NAME = "Kene Voting System";

// ---------------------------------------------------------------- terms

/**
 * What an organisation calls the people who vote and the bodies they come
 * from. Presets carry the English and Amharic forms the interface needs.
 */
export interface TermForms {
  en: string; // singular, lower case
  en_pl: string;
  am: string;
  am_pl: string;
}
export const VOTER_TERMS: Record<string, TermForms> = {
  delegate: { en: "delegate", en_pl: "delegates", am: "ተወካይ", am_pl: "ተወካዮች" },
  member: { en: "member", en_pl: "members", am: "አባል", am_pl: "አባላት" },
  representative: { en: "representative", en_pl: "representatives", am: "ተጠሪ", am_pl: "ተጠሪዎች" },
  voter: { en: "voter", en_pl: "voters", am: "መራጭ", am_pl: "መራጮች" },
};
export const GROUP_TERMS: Record<string, TermForms> = {
  council: { en: "council", en_pl: "councils", am: "ምክር ቤት", am_pl: "ምክር ቤቶች" },
  chapter: { en: "chapter", en_pl: "chapters", am: "ቅርንጫፍ", am_pl: "ቅርንጫፎች" },
  region: { en: "region", en_pl: "regions", am: "ክልል", am_pl: "ክልሎች" },
  branch: { en: "branch", en_pl: "branches", am: "ቅርንጫፍ ጽሕፈት ቤት", am_pl: "ቅርንጫፍ ጽሕፈት ቤቶች" },
  committee: { en: "committee", en_pl: "committees", am: "ኮሚቴ", am_pl: "ኮሚቴዎች" },
  constituency: { en: "constituency", en_pl: "constituencies", am: "የምርጫ ክልል", am_pl: "የምርጫ ክልሎች" },
};
export const voterTerm = (o: Pick<Org, "voter_term"> | null): TermForms => VOTER_TERMS[o?.voter_term ?? ""] ?? VOTER_TERMS.delegate;
export const groupTerm = (o: Pick<Org, "group_term"> | null): TermForms => GROUP_TERMS[o?.group_term ?? ""] ?? GROUP_TERMS.council;

/** "Association of Ethiopian Architects (Kene Voting System)". */
export function brandedName(o: Pick<Org, "name_en"> | null): string {
  return o ? `${o.name_en} (${PLATFORM_NAME})` : PLATFORM_NAME;
}

// ---------------------------------------------------------------- reads (cached briefly)

const cache = new Map<string, { org: Org; at: number }>();
const CACHE_MS = 30_000;

export function forgetOrgCache(id?: string): void {
  if (id) cache.delete(id);
  else cache.clear();
}

export async function getOrg(id: string): Promise<Org | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.org;
  const { data, error } = await rawDb.from("organizations").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (data) cache.set(id, { org: data as Org, at: Date.now() });
  return (data as Org | null) ?? null;
}

/** The organisation of the current request / update, or null. */
export async function currentOrg(): Promise<Org | null> {
  const id = currentOrgId();
  return id ? getOrg(id) : null;
}

export async function requireCurrentOrg(): Promise<Org> {
  const org = await getOrg(requireOrgId());
  if (!org) throw new Error("The selected organisation no longer exists.");
  return org;
}

/** Default invitation-code prefix of the current organisation, e.g. "AEA-2026". */
export async function defaultCodePrefix(): Promise<string> {
  const org = await currentOrg();
  return `${org?.short_code || "KVS"}-${new Date().getFullYear()}`;
}

export async function listOrgs(): Promise<Org[]> {
  const { data, error } = await rawDb.from("organizations").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Org[];
}

export async function orgByGroupChat(chatId: number): Promise<Org | null> {
  const { data, error } = await rawDb.from("organizations").select("*").eq("group_chat_id", chatId).maybeSingle();
  if (error) throw error;
  return (data as Org | null) ?? null;
}

// ---------------------------------------------------------------- writes

export interface OrgInput {
  name_en: string;
  name_am?: string | null;
  short_code: string;
  assembly_en?: string | null;
  assembly_am?: string | null;
  office_en?: string | null;
  office_am?: string | null;
  voter_term?: string;
  group_term?: string;
}

export function cleanShortCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

export async function createOrg(input: OrgInput): Promise<Org> {
  const { data, error } = await rawDb
    .from("organizations")
    .insert({
      name_en: input.name_en,
      name_am: input.name_am ?? null,
      short_code: cleanShortCode(input.short_code) || "ORG",
      assembly_en: input.assembly_en ?? null,
      assembly_am: input.assembly_am ?? null,
      office_en: input.office_en ?? null,
      office_am: input.office_am ?? null,
      voter_term: input.voter_term && VOTER_TERMS[input.voter_term] ? input.voter_term : "delegate",
      group_term: input.group_term && GROUP_TERMS[input.group_term] ? input.group_term : "council",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Org;
}

export async function updateOrg(id: string, patch: Partial<OrgInput>): Promise<Org | null> {
  const p: Record<string, unknown> = { ...patch };
  if (typeof p.short_code === "string") p.short_code = cleanShortCode(p.short_code) || "ORG";
  if (p.voter_term !== undefined && !VOTER_TERMS[String(p.voter_term)]) delete p.voter_term;
  if (p.group_term !== undefined && !GROUP_TERMS[String(p.group_term)]) delete p.group_term;
  if (Object.keys(p).length) {
    const { error } = await rawDb.from("organizations").update(p).eq("id", id);
    if (error) throw error;
  }
  forgetOrgCache(id);
  return getOrg(id);
}

/** Link (or with chatId null, unlink) the current organisation's Telegram group. */
export async function setOrgGroup(chatId: number | null, title: string | null): Promise<void> {
  const id = requireOrgId("linked group");
  const { error } = await rawDb.from("organizations").update({ group_chat_id: chatId, group_title: title }).eq("id", id);
  if (error) throw error;
  forgetOrgCache(id);
}

// ---------------------------------------------------------------- who belongs where

export function isPlatformAdmin(telegramId: number | undefined): boolean {
  return telegramId !== undefined && config.adminIds.includes(telegramId);
}

/**
 * Organisations a Telegram account belongs to — as a registered member or as
 * an admin. Platform admins (ADMIN_TELEGRAM_IDS) belong to all of them.
 */
export async function userOrgIds(telegramId: number): Promise<{ member: string[]; admin: string[] }> {
  if (isPlatformAdmin(telegramId)) {
    const all = (await listOrgs()).map((o) => o.id);
    return { member: await memberOrgIds(telegramId), admin: all };
  }
  const [{ data: a, error: aErr }] = await Promise.all([rawDb.from("admins").select("org_id").eq("telegram_user_id", telegramId)]);
  if (aErr) throw aErr;
  return { member: await memberOrgIds(telegramId), admin: [...new Set((a ?? []).map((r) => String(r.org_id)))] };
}

async function memberOrgIds(telegramId: number): Promise<string[]> {
  const { data, error } = await rawDb.from("members").select("org_id").eq("telegram_user_id", telegramId);
  if (error) throw error;
  return [...new Set((data ?? []).map((r) => String(r.org_id)))];
}

export async function getActiveOrg(telegramId: number): Promise<string | null> {
  const { data, error } = await rawDb.from("user_active_org").select("org_id").eq("telegram_user_id", telegramId).maybeSingle();
  if (error) throw error;
  return data ? String(data.org_id) : null;
}

export async function setActiveOrg(telegramId: number, orgId: string): Promise<void> {
  const { error } = await rawDb
    .from("user_active_org")
    .upsert({ telegram_user_id: telegramId, org_id: orgId, updated_at: new Date().toISOString() }, { onConflict: "telegram_user_id" });
  if (error) throw error;
}

/**
 * Which organisation a person is acting in when nothing else says so:
 * the one they asked for (if they belong to it), their chosen active
 * organisation, their only organisation, or — while the platform serves just
 * one organisation — that one. Null when it is ambiguous.
 */
export async function resolveUserOrg(telegramId: number, requested?: string | null): Promise<string | null> {
  const mine = await userOrgIds(telegramId);
  const all = new Set([...mine.member, ...mine.admin]);
  if (requested && (all.has(requested) || isPlatformAdmin(telegramId))) {
    if (await getOrg(requested)) return requested;
  }
  const active = await getActiveOrg(telegramId);
  if (active && all.has(active)) return active;
  if (all.size === 1) return [...all][0];
  if (all.size === 0) {
    const orgs = await listOrgs();
    if (orgs.length === 1) return orgs[0].id;
  }
  return null;
}
