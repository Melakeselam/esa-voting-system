import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { rawDb } from "../db.js";
import { currentOrgId, withOrg } from "../org-context.js";
import { addDbAdmin } from "./admins.js";
import { createOrg, forgetOrgCache, getOrg, listOrgs, setActiveOrg, type Org, type OrgInput } from "./orgs.js";

/**
 * Kene Voting as a business. Anyone signs in with Telegram on the business
 * pages, creates an organisation (and administers it), and buys a plan by
 * bank or mobile-money transfer; a platform administrator checks the receipt
 * and approves it, which extends the organisation's paid period.
 *
 * Without an active plan an organisation works with up to the trial number of
 * members (enough to set up and rehearse). Organisations created by the
 * platform administrators are exempt.
 */

// ---------------------------------------------------------------- settings

const DEFAULT_TRIAL_CAP = 5;

async function getBizSetting<T>(key: string): Promise<T | null> {
  const { data, error } = await rawDb.from("biz_settings").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data ? (data.value as T) : null;
}

async function setBizSetting(key: string, value: unknown): Promise<void> {
  const { error } = await rawDb.from("biz_settings").upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
}

export interface BizSettings {
  trial_member_cap: number;
}

export async function getBizSettings(): Promise<BizSettings> {
  const cap = await getBizSetting<number>("trial_member_cap");
  return { trial_member_cap: typeof cap === "number" && cap >= 0 ? cap : DEFAULT_TRIAL_CAP };
}

export async function setBizSettings(patch: Partial<BizSettings>): Promise<BizSettings> {
  if (patch.trial_member_cap !== undefined) await setBizSetting("trial_member_cap", patch.trial_member_cap);
  return getBizSettings();
}

// ---------------------------------------------------------------- accounts and sign-in

export interface BizAccount {
  telegram_user_id: number;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  ref_code: string;
  referred_by: number | null;
  created_at: string;
  last_login_at: string;
}

export interface TgIdentity {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomCode(n: number): string {
  const bytes = randomBytes(n);
  let s = "";
  for (let i = 0; i < n; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}

export async function getAccount(telegramId: number): Promise<BizAccount | null> {
  const { data, error } = await rawDb.from("biz_accounts").select("*").eq("telegram_user_id", telegramId).maybeSingle();
  if (error) throw error;
  return (data as BizAccount | null) ?? null;
}

async function accountByRef(code: string): Promise<BizAccount | null> {
  const { data, error } = await rawDb.from("biz_accounts").select("*").eq("ref_code", code.toUpperCase()).maybeSingle();
  if (error) throw error;
  return (data as BizAccount | null) ?? null;
}

/** The account of someone signing in (created on the first sign-in; the share link that brought them is kept once). */
export async function touchAccount(user: TgIdentity, ref?: string | null): Promise<BizAccount> {
  const now = new Date().toISOString();
  const existing = await getAccount(user.id);
  if (existing) {
    const { error } = await rawDb
      .from("biz_accounts")
      .update({ first_name: user.first_name ?? existing.first_name, last_name: user.last_name ?? null, username: user.username ?? null, last_login_at: now })
      .eq("telegram_user_id", user.id);
    if (error) throw error;
    return (await getAccount(user.id))!;
  }
  const referrer = ref ? await accountByRef(ref) : null;
  for (let attempt = 0; ; attempt++) {
    const { error } = await rawDb.from("biz_accounts").insert({
      telegram_user_id: user.id,
      first_name: user.first_name ?? null,
      last_name: user.last_name ?? null,
      username: user.username ?? null,
      ref_code: randomCode(8),
      referred_by: referrer && referrer.telegram_user_id !== user.id ? referrer.telegram_user_id : null,
      created_at: now,
      last_login_at: now,
    });
    if (!error) break;
    if (error.code !== "23505" || attempt >= 3) throw error;
    if (await getAccount(user.id)) break; // signed in twice at once
  }
  return (await getAccount(user.id))!;
}

/** Login links stay valid this long. */
export const LOGIN_TTL_MS = 10 * 60_000;

export async function startLogin(ref: string | null): Promise<string> {
  const nonce = randomBytes(18).toString("base64url");
  const { error } = await rawDb.from("biz_logins").insert({ nonce, ref_code: ref ? ref.toUpperCase().slice(0, 16) : null });
  if (error) throw error;
  // Old attempts are of no use to anyone.
  await rawDb.from("biz_logins").delete().lt("created_at", new Date(Date.now() - 24 * 3600_000).toISOString());
  return nonce;
}

/** The bot: this Telegram account tapped Start on the login link. False when the link is unknown, used or expired. */
export async function confirmLogin(nonce: string, user: TgIdentity): Promise<boolean> {
  const { data, error } = await rawDb.from("biz_logins").select("*").eq("nonce", nonce).maybeSingle();
  if (error) throw error;
  if (!data || data.telegram_user_id || Date.now() - new Date(String(data.created_at)).getTime() > LOGIN_TTL_MS) return false;
  const { error: uErr } = await rawDb
    .from("biz_logins")
    .update({ telegram_user_id: user.id, first_name: user.first_name ?? null, last_name: user.last_name ?? null, username: user.username ?? null })
    .eq("nonce", nonce)
    .is("telegram_user_id", null);
  if (uErr) throw uErr;
  return true;
}

export type LoginPoll = { status: "pending" | "expired" } | { status: "ok"; account: BizAccount; token: string };

/** The page: has the bot confirmed the login yet? The session is handed out once. */
export async function pollLogin(nonce: string): Promise<LoginPoll> {
  const { data, error } = await rawDb.from("biz_logins").select("*").eq("nonce", nonce).maybeSingle();
  if (error) throw error;
  if (!data || data.claimed_at) return { status: "expired" };
  if (!data.telegram_user_id) {
    return Date.now() - new Date(String(data.created_at)).getTime() > LOGIN_TTL_MS ? { status: "expired" } : { status: "pending" };
  }
  const { error: cErr } = await rawDb.from("biz_logins").update({ claimed_at: new Date().toISOString() }).eq("nonce", nonce).is("claimed_at", null);
  if (cErr) throw cErr;
  const id = Number(data.telegram_user_id);
  const account = await touchAccount(
    { id, first_name: data.first_name as string | null, last_name: data.last_name as string | null, username: data.username as string | null },
    data.ref_code as string | null,
  );
  return { status: "ok", account, token: signSession(id) };
}

// Sessions: "<telegram id>.<expiry seconds>.<hmac>", signed with a key derived from the bot token.
const SESSION_DAYS = 30;

function sessionKey(): Buffer {
  return createHmac("sha256", "kene-biz-session").update(config.botToken).digest();
}

export function signSession(telegramId: number, days = SESSION_DAYS): string {
  const body = `${telegramId}.${Math.floor(Date.now() / 1000) + days * 86400}`;
  return `${body}.${createHmac("sha256", sessionKey()).update(body).digest("base64url")}`;
}

export function verifySession(token: string): number | null {
  const m = /^(\d{1,16})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token.trim());
  if (!m) return null;
  const expected = createHmac("sha256", sessionKey()).update(`${m[1]}.${m[2]}`).digest();
  const given = Buffer.from(m[3], "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (Number(m[2]) < Date.now() / 1000) return null;
  return Number(m[1]);
}

// ---------------------------------------------------------------- plans and payment accounts

export interface PlanPrice {
  country: string;
  price: number;
  currency: string;
}

export interface Plan {
  id: string;
  name_en: string;
  name_am: string | null;
  description: string | null;
  duration_days: number;
  member_cap: number | null;
  active: boolean;
  sort: number;
  prices: PlanPrice[];
}

export interface PlanInput {
  name_en: string;
  name_am?: string | null;
  description?: string | null;
  duration_days: number;
  member_cap?: number | null;
  active?: boolean;
  sort?: number;
  prices?: PlanPrice[];
}

export async function listPlans(includeInactive = false): Promise<Plan[]> {
  let q = rawDb.from("biz_plans").select("*");
  if (!includeInactive) q = q.eq("active", true);
  const [{ data, error }, { data: prices, error: pErr }] = await Promise.all([q.order("sort", { ascending: true }), rawDb.from("biz_plan_prices").select("*")]);
  if (error) throw error;
  if (pErr) throw pErr;
  return ((data ?? []) as Omit<Plan, "prices">[])
    .sort((a, b) => a.sort - b.sort || a.duration_days - b.duration_days)
    .map((p) => ({
      ...p,
      prices: (prices ?? [])
        .filter((x) => String(x.plan_id) === p.id)
        .map((x) => ({ country: String(x.country), price: Number(x.price), currency: String(x.currency) }))
        .sort((a, b) => a.country.localeCompare(b.country)),
    }));
}

export async function getPlan(id: string): Promise<Plan | null> {
  return (await listPlans(true)).find((p) => p.id === id) ?? null;
}

export async function savePlan(id: string | null, input: PlanInput): Promise<Plan> {
  const row = {
    name_en: input.name_en,
    name_am: input.name_am ?? null,
    description: input.description ?? null,
    duration_days: input.duration_days,
    member_cap: input.member_cap ?? null,
    active: input.active ?? true,
    sort: input.sort ?? 0,
  };
  let planId = id;
  if (planId) {
    const { error } = await rawDb.from("biz_plans").update(row).eq("id", planId);
    if (error) throw error;
  } else {
    const { data, error } = await rawDb.from("biz_plans").insert(row).select("id").single();
    if (error) throw error;
    planId = String(data.id);
  }
  if (input.prices) {
    const { error } = await rawDb.from("biz_plan_prices").delete().eq("plan_id", planId);
    if (error) throw error;
    for (const p of input.prices) {
      const { error: iErr } = await rawDb.from("biz_plan_prices").insert({ plan_id: planId, country: p.country, price: p.price, currency: p.currency });
      if (iErr) throw iErr;
    }
  }
  return (await getPlan(planId!))!;
}

export interface PayMethod {
  id: string;
  country: string;
  provider: string;
  account_name: string;
  account_number: string;
  note: string | null;
  active: boolean;
  sort: number;
}

export async function listMethods(includeInactive = false): Promise<PayMethod[]> {
  let q = rawDb.from("biz_pay_methods").select("*");
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q.order("sort", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as PayMethod[]).sort((a, b) => a.country.localeCompare(b.country) || a.sort - b.sort);
}

export async function saveMethod(id: string | null, input: Omit<PayMethod, "id">): Promise<PayMethod> {
  if (id) {
    const { error } = await rawDb.from("biz_pay_methods").update(input).eq("id", id);
    if (error) throw error;
  } else {
    const { data, error } = await rawDb.from("biz_pay_methods").insert(input).select("id").single();
    if (error) throw error;
    id = String(data.id);
  }
  return (await listMethods(true)).find((m) => m.id === id)!;
}

/** Countries where at least one active plan has a price. */
export function pricedCountries(plans: Plan[]): string[] {
  return [...new Set(plans.filter((p) => p.active).flatMap((p) => p.prices.map((x) => x.country)))].sort();
}

// ---------------------------------------------------------------- an organisation's plan

export type BillingStatus = "exempt" | "active" | "trial" | "expired";

export interface OrgBilling {
  exempt: boolean;
  status: BillingStatus;
  paid_until: string | null;
  plan_name: string | null;
  /** Members the organisation may have now (null = no limit). */
  member_cap: number | null;
  members_used: number;
  trial_member_cap: number;
  pending_payment: { id: string; plan_name: string; amount: number; currency: string; created_at: string } | null;
}

export type BillingOrg = Org & { billing_exempt?: boolean | null; paid_until?: string | null; member_cap?: number | null; plan_id?: string | null; created_by?: number | null };

export function billingStatus(o: BillingOrg, now = Date.now()): BillingStatus {
  if (o.billing_exempt !== false) return "exempt";
  if (o.paid_until && new Date(o.paid_until).getTime() > now) return "active";
  return o.paid_until ? "expired" : "trial";
}

/** Members holding a place: every active member (registered or not). */
async function membersUsed(orgId: string): Promise<number> {
  const { count, error } = await rawDb.from("members").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("is_active", true);
  if (error) throw error;
  return count ?? 0;
}

export async function orgBilling(orgId: string): Promise<OrgBilling | null> {
  const o = (await getOrg(orgId)) as BillingOrg | null;
  if (!o) return null;
  const [settings, used, pending, plan] = await Promise.all([
    getBizSettings(),
    membersUsed(orgId),
    rawDb.from("biz_payments").select("id, plan_name, amount, currency, created_at").eq("org_id", orgId).eq("status", "pending").order("created_at", { ascending: false }).limit(1),
    o.plan_id ? rawDb.from("biz_plans").select("name_en").eq("id", o.plan_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (pending.error) throw pending.error;
  const status = billingStatus(o);
  const p = (pending.data ?? [])[0];
  return {
    exempt: status === "exempt",
    status,
    paid_until: o.paid_until ?? null,
    plan_name: (plan.data?.name_en as string | undefined) ?? null,
    member_cap: status === "exempt" ? null : status === "active" ? (o.member_cap ?? null) : settings.trial_member_cap,
    members_used: used,
    trial_member_cap: settings.trial_member_cap,
    pending_payment: p ? { id: String(p.id), plan_name: String(p.plan_name), amount: Number(p.amount), currency: String(p.currency), created_at: String(p.created_at) } : null,
  };
}

/** Adding members would go past what the organisation's plan allows. */
export class PlanLimitError extends Error {
  constructor(
    readonly cap: number,
    readonly used: number,
    readonly requested: number,
    readonly status: BillingStatus,
  ) {
    const left = Math.max(0, cap - used);
    super(
      (status === "active"
        ? `Your plan allows ${cap} members`
        : status === "expired"
          ? `Your plan has ended; without a plan an organisation can have ${cap} members`
          : `Without a plan an organisation can have ${cap} members (enough to set up and rehearse)`) +
        ` and ${used} already hold a place, so ` +
        (left ? `only ${left} more can be added (not ${requested}).` : "no more can be added.") +
        " Buy or upgrade a plan on the Kene Voting business page.",
    );
  }
}

/** Throws PlanLimitError when the current organisation cannot take `count` more members. */
export async function assertRoomForMembers(count: number): Promise<void> {
  const orgId = currentOrgId();
  if (!orgId || count <= 0) return;
  const o = (await getOrg(orgId)) as BillingOrg | null;
  if (!o) return;
  const status = billingStatus(o);
  if (status === "exempt") return;
  const cap = status === "active" ? (o.member_cap ?? null) : (await getBizSettings()).trial_member_cap;
  if (cap === null) return;
  const used = await membersUsed(orgId);
  if (used + count > cap) throw new PlanLimitError(cap, used, count, status);
}

// ---------------------------------------------------------------- organisations created on the business pages

/** Organisations an account may manage on the business pages: the ones it created or administers. */
export async function manageableOrgIds(telegramId: number): Promise<string[]> {
  const [{ data: created, error: cErr }, { data: admin, error: aErr }] = await Promise.all([
    rawDb.from("organizations").select("id").eq("created_by", telegramId),
    rawDb.from("admins").select("org_id").eq("telegram_user_id", telegramId),
  ]);
  if (cErr) throw cErr;
  if (aErr) throw aErr;
  return [...new Set([...(created ?? []), ...(admin ?? []).map((r) => ({ id: r.org_id }))].map((r) => String(r.id)))];
}

/** At most this many organisations per creator (they can ask the platform for more). */
export const MAX_ORGS_PER_CREATOR = 10;

export class TooManyOrgsError extends Error {}

export async function createOwnOrg(creator: TgIdentity, input: OrgInput): Promise<Org> {
  const { count, error } = await rawDb.from("organizations").select("id", { count: "exact", head: true }).eq("created_by", creator.id);
  if (error) throw error;
  if ((count ?? 0) >= MAX_ORGS_PER_CREATOR) throw new TooManyOrgsError(`You have created ${MAX_ORGS_PER_CREATOR} organisations already; contact Kene Technologies for more.`);
  const org = await createOrg(input);
  const { error: uErr } = await rawDb.from("organizations").update({ billing_exempt: false, created_by: creator.id }).eq("id", org.id);
  if (uErr) throw uErr;
  forgetOrgCache(org.id);
  const name = [creator.first_name, creator.last_name].filter(Boolean).join(" ") || creator.username || null;
  await withOrg(org.id, () => addDbAdmin(creator.id, name, creator.id));
  await setActiveOrg(creator.id, org.id);
  return (await getOrg(org.id))!;
}

// ---------------------------------------------------------------- payments

export interface Payment {
  id: string;
  org_id: string;
  telegram_user_id: number;
  plan_id: string | null;
  plan_name: string;
  duration_days: number;
  member_cap: number | null;
  country: string;
  amount: number;
  currency: string;
  method_id: string | null;
  method_label: string | null;
  reference: string;
  receipt?: string | null;
  status: "pending" | "approved" | "rejected";
  review_note: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
}

const PAYMENT_COLUMNS =
  "id, org_id, telegram_user_id, plan_id, plan_name, duration_days, member_cap, country, amount, currency, method_id, method_label, reference, status, review_note, reviewed_by, reviewed_at, period_start, period_end, created_at";

function asPayment(r: Record<string, unknown>): Payment {
  return {
    ...(r as unknown as Payment),
    amount: Number(r.amount),
    telegram_user_id: Number(r.telegram_user_id),
    reviewed_by: r.reviewed_by == null ? null : Number(r.reviewed_by),
  };
}

export class PaymentError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface PaymentInput {
  plan_id: string;
  country: string;
  method_id: string;
  reference: string;
  receipt: string | null;
}

/** A creator reports a transfer; the amount comes from the plan's price in that country, never from the caller. */
export async function filePayment(orgId: string, payer: number, input: PaymentInput): Promise<Payment> {
  const plan = await getPlan(input.plan_id);
  if (!plan || !plan.active) throw new PaymentError("This plan is no longer offered.", "no_plan");
  const price = plan.prices.find((p) => p.country === input.country);
  if (!price) throw new PaymentError("This plan has no price in that country.", "no_price");
  const method = (await listMethods()).find((m) => m.id === input.method_id && m.country === input.country);
  if (!method) throw new PaymentError("Choose one of the accounts listed for that country.", "no_method");
  const { data: pending, error: pErr } = await rawDb.from("biz_payments").select("id").eq("org_id", orgId).eq("status", "pending").limit(1);
  if (pErr) throw pErr;
  if ((pending ?? []).length) throw new PaymentError("A payment for this organisation is already under review.", "pending_exists");
  const { data, error } = await rawDb
    .from("biz_payments")
    .insert({
      org_id: orgId,
      telegram_user_id: payer,
      plan_id: plan.id,
      plan_name: plan.name_en,
      duration_days: plan.duration_days,
      member_cap: plan.member_cap,
      country: input.country,
      amount: price.price,
      currency: price.currency,
      method_id: method.id,
      method_label: `${method.provider} · ${method.account_number}`,
      reference: input.reference,
      receipt: input.receipt,
    })
    .select(PAYMENT_COLUMNS)
    .single();
  if (error) throw error;
  return asPayment(data);
}

export async function listPayments(filter: { status?: string; orgId?: string } = {}): Promise<Payment[]> {
  let q = rawDb.from("biz_payments").select(PAYMENT_COLUMNS);
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.orgId) q = q.eq("org_id", filter.orgId);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(500);
  if (error) throw error;
  return (data ?? []).map(asPayment);
}

export async function getPayment(id: string, withReceipt = false): Promise<Payment | null> {
  const { data, error } = await rawDb.from("biz_payments").select(withReceipt ? `${PAYMENT_COLUMNS}, receipt` : PAYMENT_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? asPayment(data) : null;
}

/**
 * Approve a payment: the organisation's paid period is extended by the plan's
 * duration — from the end of the current period while one is running, else
 * from now — and its member limit becomes the plan's.
 */
export async function approvePayment(id: string, reviewer: number): Promise<Payment> {
  const p = await getPayment(id);
  if (!p) throw new PaymentError("Payment not found.", "not_found");
  if (p.status !== "pending") throw new PaymentError(`This payment was already ${p.status}.`, "not_pending");
  const o = (await getOrg(p.org_id)) as BillingOrg | null;
  if (!o) throw new PaymentError("The organisation no longer exists.", "not_found");
  const now = Date.now();
  const start = o.paid_until && new Date(o.paid_until).getTime() > now ? new Date(o.paid_until) : new Date(now);
  const end = new Date(start.getTime() + p.duration_days * 86400_000);
  const { data: claimed, error } = await rawDb
    .from("biz_payments")
    .update({ status: "approved", reviewed_by: reviewer, reviewed_at: new Date(now).toISOString(), period_start: start.toISOString(), period_end: end.toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) throw error;
  if (!(claimed ?? []).length) throw new PaymentError("This payment was reviewed meanwhile.", "not_pending");
  const { error: oErr } = await rawDb.from("organizations").update({ paid_until: end.toISOString(), member_cap: p.member_cap, plan_id: p.plan_id }).eq("id", p.org_id);
  if (oErr) throw oErr;
  forgetOrgCache(p.org_id);
  return (await getPayment(id))!;
}

export async function rejectPayment(id: string, reviewer: number, note: string): Promise<Payment> {
  const { data, error } = await rawDb
    .from("biz_payments")
    .update({ status: "rejected", reviewed_by: reviewer, reviewed_at: new Date().toISOString(), review_note: note })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) throw error;
  if (!(data ?? []).length) throw new PaymentError("Only a payment under review can be rejected.", "not_pending");
  return (await getPayment(id))!;
}

/** The platform extends (or shortens, with negative days) an organisation's paid period by hand, or changes its member limit. */
export async function adjustOrgPlan(orgId: string, days: number, memberCap: number | null | undefined): Promise<void> {
  const o = (await getOrg(orgId)) as BillingOrg | null;
  if (!o) throw new PaymentError("Organisation not found.", "not_found");
  const patch: Record<string, unknown> = {};
  if (days) {
    const now = Date.now();
    const from = o.paid_until && new Date(o.paid_until).getTime() > now ? new Date(o.paid_until).getTime() : now;
    patch.paid_until = new Date(from + days * 86400_000).toISOString();
  }
  if (memberCap !== undefined) patch.member_cap = memberCap;
  if (Object.keys(patch).length) {
    const { error } = await rawDb.from("organizations").update(patch).eq("id", orgId);
    if (error) throw error;
    forgetOrgCache(orgId);
  }
}

export async function setOrgExempt(orgId: string, exempt: boolean): Promise<void> {
  const { error } = await rawDb.from("organizations").update({ billing_exempt: exempt }).eq("id", orgId);
  if (error) throw error;
  forgetOrgCache(orgId);
}

// ---------------------------------------------------------------- the platform's overview

export async function businessSummary() {
  const [orgs, payments, { data: accounts, error }] = await Promise.all([listOrgs(), listPayments(), rawDb.from("biz_accounts").select("telegram_user_id, referred_by, created_at")]);
  if (error) throw error;
  const byStatus: Record<BillingStatus, number> = { exempt: 0, active: 0, trial: 0, expired: 0 };
  for (const o of orgs) byStatus[billingStatus(o as BillingOrg)]++;
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const revenue: Record<string, { total: number; month: number; count: number }> = {};
  for (const p of payments) {
    if (p.status !== "approved") continue;
    const r = (revenue[p.currency] ??= { total: 0, month: 0, count: 0 });
    r.total += p.amount;
    r.count++;
    if (p.reviewed_at && new Date(p.reviewed_at) >= monthStart) r.month += p.amount;
  }
  const accs = accounts ?? [];
  return {
    organisations: { total: orgs.length, ...byStatus },
    payments: { pending: payments.filter((p) => p.status === "pending").length, approved: payments.filter((p) => p.status === "approved").length, rejected: payments.filter((p) => p.status === "rejected").length },
    revenue: Object.entries(revenue).map(([currency, r]) => ({ currency, ...r })),
    accounts: { total: accs.length, referred: accs.filter((a) => a.referred_by).length, this_month: accs.filter((a) => new Date(String(a.created_at)) >= monthStart).length },
  };
}

/** Accounts with whom they brought (share links) and how many organisations they created. */
export async function listAccounts() {
  const [{ data, error }, orgs] = await Promise.all([rawDb.from("biz_accounts").select("*").order("created_at", { ascending: false }).limit(500), listOrgs()]);
  if (error) throw error;
  const accs = (data ?? []) as BizAccount[];
  const name = (a: BizAccount | undefined) => (a ? [a.first_name, a.last_name].filter(Boolean).join(" ") || (a.username ? "@" + a.username : String(a.telegram_user_id)) : null);
  const byId = new Map(accs.map((a) => [Number(a.telegram_user_id), a]));
  return accs.map((a) => ({
    telegram_user_id: Number(a.telegram_user_id),
    name: name(a),
    username: a.username,
    ref_code: a.ref_code,
    referred_by: a.referred_by ? Number(a.referred_by) : null,
    referred_by_name: a.referred_by ? name(byId.get(Number(a.referred_by))) : null,
    referrals: accs.filter((x) => Number(x.referred_by) === Number(a.telegram_user_id)).length,
    organisations: orgs.filter((o) => Number((o as BillingOrg).created_by) === Number(a.telegram_user_id)).length,
    created_at: a.created_at,
    last_login_at: a.last_login_at,
  }));
}

