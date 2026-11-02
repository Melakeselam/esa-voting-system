import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "../config.js";
import { audit } from "../db.js";
import { bot, ensureBotReady } from "../bot/instance.js";
import { openLink } from "../bot/group-commands.js";
import { escapeHtml } from "../bot/ui.js";
import { withOrg } from "../org-context.js";
import { isAdminUser } from "../services/admins.js";
import {
  adjustOrgPlan,
  approvePayment,
  billingStatus,
  businessSummary,
  createOwnOrg,
  filePayment,
  getAccount,
  getBizSettings,
  getPayment,
  listAccounts,
  listMethods,
  listPayments,
  listPlans,
  manageableOrgIds,
  orgBilling,
  PaymentError,
  pollLogin,
  pricedCountries,
  rejectPayment,
  saveMethod,
  savePlan,
  setBizSettings,
  setOrgExempt,
  signSession,
  startLogin,
  touchAccount,
  TooManyOrgsError,
  verifySession,
  type BillingOrg,
  type BizAccount,
  type PlanPrice,
} from "../services/billing.js";
import { brandedName, getOrg, GROUP_TERMS, isPlatformAdmin, listOrgs, PLATFORM_NAME, VOTER_TERMS, type OrgInput } from "../services/orgs.js";
import { verifyInitData, type TgUser } from "./auth.js";
import { asObject, bool, HttpError, int, json, readJsonBody, str } from "./util.js";

/**
 * Business API (/api/biz): the pages where anyone signs in with Telegram,
 * creates an organisation and pays for a plan, and the platform
 * administrators' console (plans, payment accounts, payments, organisations).
 *
 * Signed in with a session token ("Authorization: Bearer …") from the bot
 * login, or — inside Telegram — with the Mini App's initData ("tma …").
 * Other sites (the company website) may call it when listed in BUSINESS_ORIGINS.
 */

interface Ctx {
  req: IncomingMessage;
  /** Null on public routes when nobody is signed in. */
  userId: number | null;
  tgUser: TgUser | null;
  query: URLSearchParams;
  body(): Promise<Record<string, unknown>>;
}

type Access = "public" | "user" | "platform";
type Handler = (ctx: Ctx, params: string[]) => Promise<unknown>;

const routes: { method: string; pattern: RegExp; access: Access; handler: Handler }[] = [];
const route = (method: string, pattern: string, access: Access, handler: Handler) => routes.push({ method, pattern: new RegExp(`^${pattern}$`), access, handler });

const UUID = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = String(req.headers.origin ?? "").replace(/\/$/, "");
  if (!origin || !config.businessOrigins.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

export async function handleBizApi(req: IncomingMessage, res: ServerResponse, path: string, method: string, query: URLSearchParams): Promise<void> {
  const cors = corsHeaders(req);
  for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Who is asking: a session token, or Telegram's initData inside the Mini App.
  const auth = String(req.headers.authorization ?? "").trim();
  let userId: number | null = null;
  let tgUser: TgUser | null = null;
  if (/^bearer /i.test(auth)) userId = verifySession(auth.slice(7));
  else if (/^tma /i.test(auth)) {
    const v = verifyInitData(auth.slice(4).trim(), config.botToken);
    if (v) {
      userId = v.user.id;
      tgUser = v.user;
    }
  }

  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.pattern.exec(path);
    if (!m) continue;
    if (r.access !== "public" && userId === null) throw new HttpError(401, "Sign in with Telegram first.", "no_auth");
    if (r.access === "platform" && !isPlatformAdmin(userId ?? undefined)) throw new HttpError(403, "Only the platform administrators can do this.", "forbidden");
    let cached: Record<string, unknown> | null = null;
    const ctx: Ctx = { req, userId, tgUser, query, body: async () => (cached ??= asObject((await readJsonBody(req, 3_000_000)) ?? {})) };
    try {
      json(res, 200, (await r.handler(ctx, m.slice(1))) ?? { ok: true });
    } catch (err) {
      if (err instanceof PaymentError) throw new HttpError(err.code === "not_found" ? 404 : 409, err.message, err.code);
      if (err instanceof TooManyOrgsError) throw new HttpError(409, err.message, "too_many_orgs");
      throw err;
    }
    return;
  }
  throw new HttpError(404, `No route for ${method} ${path}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pageUrl(hash = ""): string {
  return `${config.businessPageUrl ?? `${config.publicUrl ?? ""}/business/`}${hash}`;
}

function shareLink(a: BizAccount): string {
  return pageUrl(`?ref=${encodeURIComponent(a.ref_code)}`);
}

function accountView(a: BizAccount) {
  return {
    telegram_user_id: Number(a.telegram_user_id),
    first_name: a.first_name,
    last_name: a.last_name,
    username: a.username,
    ref_code: a.ref_code,
    share_link: shareLink(a),
    created_at: a.created_at,
  };
}

/** Where to go from the business pages: the app, and the link that adds the bot to a group as an administrator with the rights it needs. */
async function links() {
  await ensureBotReady();
  const username = bot.botInfo.username;
  return {
    bot_username: username,
    app: openLink(username, "home"),
    bot: `https://t.me/${username}`,
    add_to_group: `https://t.me/${username}?startgroup=kene&admin=change_info+delete_messages+restrict_members+invite_users+pin_messages+manage_topics`,
  };
}

async function orgCard(id: string, viewer: number) {
  const o = (await getOrg(id)) as BillingOrg | null;
  if (!o) return null;
  const billing = await orgBilling(id);
  return {
    id: o.id,
    name_en: o.name_en,
    name_am: o.name_am,
    branded: brandedName(o),
    short_code: o.short_code,
    structure: o.structure ?? "councils",
    group_title: o.group_title,
    group_linked: Boolean(o.group_chat_id),
    created_at: o.created_at,
    is_creator: Number(o.created_by) === viewer,
    billing,
  };
}

/** The signed-in person may manage this organisation on the business pages (its creator or an admin of it, or a platform admin). */
async function requireManage(ctx: Ctx, orgId: string): Promise<void> {
  if (isPlatformAdmin(ctx.userId!)) return;
  if (!(await manageableOrgIds(ctx.userId!)).includes(orgId)) {
    // An admin added in the app also counts (the admins cache is per organisation).
    if (!(await withOrg(orgId, () => isAdminUser(ctx.userId!)))) throw new HttpError(403, "You do not manage this organisation.", "forbidden");
  }
}

async function ensureAccount(ctx: Ctx): Promise<BizAccount> {
  const a = await getAccount(ctx.userId!);
  if (a) return a;
  // Signed in through the Mini App for the first time.
  return touchAccount(ctx.tgUser ?? { id: ctx.userId! });
}

function country(v: unknown): string {
  const c = str(v, "Country", { min: 2, max: 2 }).toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) throw new HttpError(400, "Country must be a two-letter code (ET, KE, US…).");
  return c;
}

async function tellPlatformAdmins(text: string, button: { label: string; url: string } | null): Promise<void> {
  await ensureBotReady();
  for (const id of config.adminIds) {
    try {
      await bot.api.sendMessage(id, text, {
        parse_mode: "HTML",
        ...(button && /^https:\/\//.test(button.url) ? { reply_markup: { inline_keyboard: [[{ text: button.label, url: button.url }]] } } : {}),
      });
    } catch {
      // That admin has not opened the bot.
    }
  }
}

async function tell(telegramId: number, text: string, button: { label: string; url: string } | null): Promise<void> {
  await ensureBotReady();
  try {
    await bot.api.sendMessage(telegramId, text, {
      parse_mode: "HTML",
      ...(button && /^https:\/\//.test(button.url) ? { reply_markup: { inline_keyboard: [[{ text: button.label, url: button.url }]] } } : {}),
    });
  } catch {
    // Not reachable in Telegram.
  }
}

const money = (amount: number, currency: string) => `${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;

// ---------------------------------------------------------------------------
// Public: what is on offer, and signing in
// ---------------------------------------------------------------------------

route("GET", "/catalog", "public", async () => {
  const plans = await listPlans();
  return {
    platform: PLATFORM_NAME,
    trial_member_cap: (await getBizSettings()).trial_member_cap,
    countries: pricedCountries(plans),
    plans: plans.map((p) => ({ id: p.id, name_en: p.name_en, name_am: p.name_am, description: p.description, duration_days: p.duration_days, member_cap: p.member_cap, prices: p.prices })),
    terms: { voter: VOTER_TERMS, group: GROUP_TERMS },
    links: await links(),
  };
});

/** Start signing in: the page opens the returned link (the bot) and then polls. */
route("POST", "/login/start", "public", async (ctx) => {
  const b = await ctx.body();
  const ref = str(b.ref, "ref", { optional: true, max: 16 }) || null;
  const nonce = await startLogin(ref);
  await ensureBotReady();
  return { nonce, link: `https://t.me/${bot.botInfo.username}?start=weblogin_${nonce}`, expires_in: 600 };
});

route("GET", "/login/poll", "public", async (ctx) => {
  const nonce = ctx.query.get("nonce") ?? "";
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(nonce)) throw new HttpError(400, "Bad login code.");
  const r = await pollLogin(nonce);
  if (r.status !== "ok") return r;
  await audit(r.account.telegram_user_id, "biz_signed_in", { via: "bot-link" });
  return { status: "ok", token: r.token, account: accountView(r.account) };
});

/** Inside Telegram (the Mini App's initData): a session for the business pages straight away. */
route("POST", "/login/telegram", "user", async (ctx) => {
  if (!ctx.tgUser) throw new HttpError(400, "Open this inside Telegram.");
  const b = await ctx.body();
  const a = await touchAccount(ctx.tgUser, str(b.ref, "ref", { optional: true, max: 16 }) || null);
  return { status: "ok", token: signSession(ctx.userId!), account: accountView(a) };
});

// ---------------------------------------------------------------------------
// Signed in: my organisations, creating one, paying
// ---------------------------------------------------------------------------

route("GET", "/me", "user", async (ctx) => {
  const a = await ensureAccount(ctx);
  const ids = await manageableOrgIds(ctx.userId!);
  const orgs = (await Promise.all(ids.map((id) => orgCard(id, ctx.userId!)))).filter(Boolean);
  orgs.sort((x, y) => String(y!.created_at).localeCompare(String(x!.created_at)));
  return { account: accountView(a), platform_admin: isPlatformAdmin(ctx.userId!), orgs, links: await links() };
});

function orgInput(b: Record<string, unknown>): OrgInput {
  const input: OrgInput = {
    name_en: str(b.name_en, "Organisation name", { min: 2, max: 160 }),
    short_code: str(b.short_code, "Short code", { min: 2, max: 8 }),
    name_am: str(b.name_am, "Amharic name", { optional: true, max: 160 }) || null,
    assembly_en: str(b.assembly_en, "Assembly", { optional: true, max: 160 }) || null,
    assembly_am: str(b.assembly_am, "Assembly (Amharic)", { optional: true, max: 160 }) || null,
    office_en: str(b.office_en, "Office", { optional: true, max: 160 }) || null,
    office_am: str(b.office_am, "Office (Amharic)", { optional: true, max: 160 }) || null,
  };
  if (b.voter_term !== undefined && b.voter_term !== "") {
    if (!VOTER_TERMS[String(b.voter_term)]) throw new HttpError(400, "Unknown voter term.");
    input.voter_term = String(b.voter_term);
  }
  if (b.group_term !== undefined && b.group_term !== "") {
    if (!GROUP_TERMS[String(b.group_term)]) throw new HttpError(400, "Unknown group term.");
    input.group_term = String(b.group_term);
  }
  if (b.structure !== undefined) {
    if (b.structure !== "councils" && b.structure !== "direct") throw new HttpError(400, "structure must be 'councils' or 'direct'.");
    input.structure = b.structure;
  }
  return input;
}

/** Anyone signed in creates an organisation and becomes its administrator; it starts without a plan (trial member limit). */
route("POST", "/orgs", "user", async (ctx) => {
  const a = await ensureAccount(ctx);
  const org = await createOwnOrg(
    { id: ctx.userId!, first_name: a.first_name, last_name: a.last_name, username: a.username },
    orgInput(await ctx.body()),
  );
  await withOrg(org.id, () => audit(ctx.userId!, "organization_created", { name: org.name_en, short_code: org.short_code, via: "business" }));
  const who = [a.first_name, a.last_name].filter(Boolean).join(" ") || (a.username ? "@" + a.username : String(ctx.userId));
  await tellPlatformAdmins(`🆕 <b>${escapeHtml(org.name_en)}</b> (${escapeHtml(org.short_code)}) was created by ${escapeHtml(who)} on the business page.`, { label: "🏢 Open the console", url: pageUrl("#/admin/orgs") });
  return { org: await orgCard(org.id, ctx.userId!), links: await links() };
});

route("GET", `/orgs/${UUID}`, "user", async (ctx, [id]) => {
  await requireManage(ctx, id);
  const card = await orgCard(id, ctx.userId!);
  if (!card) throw new HttpError(404, "Organisation not found.");
  return { org: card, payments: await listPayments({ orgId: id }), links: await links() };
});

/** What this organisation can buy in a country, and where to send the money. */
route("GET", `/orgs/${UUID}/pay-options`, "user", async (ctx, [id]) => {
  await requireManage(ctx, id);
  const plans = await listPlans();
  const countries = pricedCountries(plans);
  const c = (ctx.query.get("country") ?? "").toUpperCase();
  const chosen = countries.includes(c) ? c : countries.includes("ET") ? "ET" : (countries[0] ?? null);
  const methods = chosen ? (await listMethods()).filter((m) => m.country === chosen) : [];
  return {
    countries,
    country: chosen,
    plans: plans
      .map((p) => ({ id: p.id, name_en: p.name_en, name_am: p.name_am, description: p.description, duration_days: p.duration_days, member_cap: p.member_cap, price: p.prices.find((x) => x.country === chosen) ?? null }))
      .filter((p) => p.price),
    methods: methods.map((m) => ({ id: m.id, provider: m.provider, account_name: m.account_name, account_number: m.account_number, note: m.note })),
  };
});

/** Report a transfer with its receipt; a platform administrator checks it. */
route("POST", `/orgs/${UUID}/payments`, "user", async (ctx, [id]) => {
  await requireManage(ctx, id);
  const b = await ctx.body();
  const receipt = b.receipt === undefined || b.receipt === null || b.receipt === "" ? null : b.receipt;
  if (receipt !== null) {
    if (typeof receipt !== "string" || !/^data:(image\/(jpeg|png|webp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/.test(receipt)) throw new HttpError(400, "The receipt must be a JPEG, PNG or WebP image, or a PDF.");
    if (receipt.length > 2_500_000) throw new HttpError(400, "The receipt file is too large (at most about 1.8 MB).");
  }
  const reference = str(b.reference, "Transaction reference", { min: 3, max: 80 });
  if (!receipt && reference.length < 6) throw new HttpError(400, "Attach the receipt, or enter the full transaction reference.");
  const p = await filePayment(id, ctx.userId!, {
    plan_id: str(b.plan_id, "Plan", { min: 36, max: 36 }),
    country: country(b.country),
    method_id: str(b.method_id, "Account", { min: 36, max: 36 }),
    reference,
    receipt: receipt as string | null,
  });
  const org = await getOrg(id);
  await withOrg(id, () => audit(ctx.userId!, "payment_filed", { plan: p.plan_name, amount: p.amount, currency: p.currency, reference: p.reference }));
  await tellPlatformAdmins(
    `💳 <b>Payment to review</b>\n${escapeHtml(org?.name_en ?? "")}: ${escapeHtml(p.plan_name)} — ${escapeHtml(money(p.amount, p.currency))}\n` +
      `${escapeHtml(p.method_label ?? "")} · ref ${escapeHtml(p.reference)}`,
    { label: "🧾 Review the payment", url: pageUrl(`#/admin/payments/${p.id}`) },
  );
  return { payment: p };
});

// ---------------------------------------------------------------------------
// Platform console
// ---------------------------------------------------------------------------

route("GET", "/admin/summary", "platform", async () => businessSummary());

route("GET", "/admin/payments", "platform", async (ctx) => {
  const status = ctx.query.get("status") || undefined;
  if (status && !["pending", "approved", "rejected"].includes(status)) throw new HttpError(400, "Unknown status.");
  const payments = await listPayments({ status });
  const names = new Map((await listOrgs()).map((o) => [o.id, o.name_en]));
  return { items: payments.map((p) => ({ ...p, org_name: names.get(p.org_id) ?? null })) };
});

route("GET", `/admin/payments/${UUID}`, "platform", async (ctx, [id]) => {
  const p = await getPayment(id, true);
  if (!p) throw new HttpError(404, "Payment not found.");
  const [org, payer] = await Promise.all([getOrg(p.org_id), getAccount(p.telegram_user_id)]);
  return { payment: { ...p, org_name: org?.name_en ?? null }, payer: payer ? accountView(payer) : { telegram_user_id: p.telegram_user_id }, billing: await orgBilling(p.org_id) };
});

route("POST", `/admin/payments/${UUID}/approve`, "platform", async (ctx, [id]) => {
  const p = await approvePayment(id, ctx.userId!);
  const org = await getOrg(p.org_id);
  await withOrg(p.org_id, () => audit(ctx.userId!, "payment_approved", { plan: p.plan_name, amount: p.amount, currency: p.currency, until: p.period_end }));
  await tell(
    p.telegram_user_id,
    `✅ <b>Payment accepted</b>\n${escapeHtml(org?.name_en ?? "")}: ${escapeHtml(p.plan_name)} is active until ${escapeHtml(String(p.period_end).slice(0, 10))}.` +
      (p.member_cap ? ` Up to ${p.member_cap} members.` : " No member limit."),
    { label: "🗳 Open the app", url: (await links()).app },
  );
  return { payment: p, billing: await orgBilling(p.org_id) };
});

route("POST", `/admin/payments/${UUID}/reject`, "platform", async (ctx, [id]) => {
  const note = str((await ctx.body()).note, "Reason", { min: 3, max: 300 });
  const p = await rejectPayment(id, ctx.userId!, note);
  const org = await getOrg(p.org_id);
  await withOrg(p.org_id, () => audit(ctx.userId!, "payment_rejected", { plan: p.plan_name, note }));
  await tell(
    p.telegram_user_id,
    `⚠️ <b>Payment not accepted</b>\n${escapeHtml(org?.name_en ?? "")}: ${escapeHtml(p.plan_name)}\n<i>${escapeHtml(note)}</i>\n\nFix it and send the receipt again on the business page.`,
    { label: "💳 Open the business page", url: pageUrl(`#/org/${p.org_id}`) },
  );
  return { payment: p };
});

route("GET", "/admin/orgs", "platform", async () => {
  const [orgs, accounts] = await Promise.all([listOrgs(), listAccounts()]);
  const names = new Map(accounts.map((a) => [a.telegram_user_id, a]));
  const items = [];
  for (const o of orgs as BillingOrg[]) {
    const creator = o.created_by ? names.get(Number(o.created_by)) : undefined;
    items.push({
      id: o.id,
      name_en: o.name_en,
      short_code: o.short_code,
      created_at: o.created_at,
      group_linked: Boolean(o.group_chat_id),
      status: billingStatus(o),
      creator: o.created_by ? { telegram_user_id: Number(o.created_by), name: creator?.name ?? null, referred_by_name: creator?.referred_by_name ?? null } : null,
      billing: await orgBilling(o.id),
    });
  }
  return { items };
});

route("POST", `/admin/orgs/${UUID}/adjust`, "platform", async (ctx, [id]) => {
  const b = await ctx.body();
  const days = int(b.days, "Days", { optional: true, min: -3650, max: 3650 }) ?? 0;
  const cap = b.member_cap === undefined ? undefined : b.member_cap === null || b.member_cap === "" ? null : int(b.member_cap, "Member limit", { min: 1, max: 1_000_000 });
  await adjustOrgPlan(id, days, cap);
  await withOrg(id, () => audit(ctx.userId!, "plan_adjusted", { days, member_cap: cap }));
  return { billing: await orgBilling(id) };
});

route("POST", `/admin/orgs/${UUID}/exempt`, "platform", async (ctx, [id]) => {
  const on = bool((await ctx.body()).on, "on", true);
  await setOrgExempt(id, on);
  await withOrg(id, () => audit(ctx.userId!, on ? "billing_exempted" : "billing_required", {}));
  return { billing: await orgBilling(id) };
});

function planBody(b: Record<string, unknown>) {
  const prices: PlanPrice[] = [];
  if (b.prices !== undefined) {
    if (!Array.isArray(b.prices)) throw new HttpError(400, "prices must be a list.");
    const seen = new Set<string>();
    for (const raw of b.prices) {
      const x = asObject(raw);
      const c = country(x.country);
      if (seen.has(c)) throw new HttpError(400, `Two prices for ${c}.`);
      seen.add(c);
      const price = Number(x.price);
      if (!Number.isFinite(price) || price < 0) throw new HttpError(400, `The price for ${c} must be a number.`);
      prices.push({ country: c, price: Math.round(price * 100) / 100, currency: str(x.currency, "Currency", { min: 3, max: 3 }).toUpperCase() });
    }
  }
  return {
    name_en: str(b.name_en, "Plan name", { min: 2, max: 80 }),
    name_am: str(b.name_am, "Amharic name", { optional: true, max: 80 }) || null,
    description: str(b.description, "Description", { optional: true, max: 400 }) || null,
    duration_days: int(b.duration_days, "Duration (days)", { min: 1, max: 3650 })!,
    member_cap: b.member_cap === null || b.member_cap === "" || b.member_cap === undefined ? null : int(b.member_cap, "Member limit", { min: 1, max: 1_000_000 }),
    active: bool(b.active, "active", true),
    sort: int(b.sort, "Order", { optional: true, min: 0, max: 1000 }) ?? 0,
    prices: b.prices === undefined ? undefined : prices,
  };
}

route("GET", "/admin/plans", "platform", async () => ({ items: await listPlans(true) }));
route("POST", "/admin/plans", "platform", async (ctx) => {
  const plan = await savePlan(null, planBody(await ctx.body()));
  await audit(ctx.userId!, "plan_saved", { plan: plan.name_en });
  return { plan };
});
route("PATCH", `/admin/plans/${UUID}`, "platform", async (ctx, [id]) => {
  const plan = await savePlan(id, planBody(await ctx.body()));
  await audit(ctx.userId!, "plan_saved", { plan: plan.name_en });
  return { plan };
});

function methodBody(b: Record<string, unknown>) {
  return {
    country: country(b.country),
    provider: str(b.provider, "Bank or service", { min: 2, max: 80 }),
    account_name: str(b.account_name, "Account name", { min: 2, max: 120 }),
    account_number: str(b.account_number, "Account number", { min: 3, max: 60 }),
    note: str(b.note, "Note", { optional: true, max: 300 }) || null,
    active: bool(b.active, "active", true),
    sort: int(b.sort, "Order", { optional: true, min: 0, max: 1000 }) ?? 0,
  };
}

route("GET", "/admin/methods", "platform", async () => ({ items: await listMethods(true) }));
route("POST", "/admin/methods", "platform", async (ctx) => ({ method: await saveMethod(null, methodBody(await ctx.body())) }));
route("PATCH", `/admin/methods/${UUID}`, "platform", async (ctx, [id]) => ({ method: await saveMethod(id, methodBody(await ctx.body())) }));

route("GET", "/admin/accounts", "platform", async () => ({ items: await listAccounts() }));

route("GET", "/admin/settings", "platform", async () => getBizSettings());
route("POST", "/admin/settings", "platform", async (ctx) => {
  const b = await ctx.body();
  const s = await setBizSettings({ trial_member_cap: int(b.trial_member_cap, "Members without a plan", { min: 0, max: 1000 })! });
  await audit(ctx.userId!, "biz_settings_saved", s);
  return s;
});
