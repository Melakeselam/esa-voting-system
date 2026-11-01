import { Composer, InlineKeyboard } from "grammy";
import type { Context, NextFunction } from "grammy";
import { rawDb } from "../db.js";
import { withOrg } from "../org-context.js";
import { findByToken } from "../services/members.js";
import {
  brandedName,
  getOrg,
  isPlatformAdmin,
  listOrgs,
  orgByGroupChat,
  resolveUserOrg,
  setActiveOrg,
  userOrgIds,
  type Org,
} from "../services/orgs.js";
import { sessionOrgId } from "./login.js";
import { escapeHtml } from "./ui.js";
import { refuseGroupWithoutTopics } from "./topics-required.js";

/**
 * Runs first for every Telegram update: decides which organisation the update
 * belongs to and runs the rest of the bot inside it (org-context.ts).
 *   - a group / its topics          → the organisation that linked the group
 *   - a vote or quorum button       → the organisation of that resolution
 *   - an organisation-carrying button (gate, switch, pick) → that organisation
 *   - /start inv_<code>             → the organisation of the invitation code
 *   - a private chat                → the person's chosen / only organisation
 * When a private message is ambiguous (the person belongs to several
 * organisations and has not chosen one) the bot asks with buttons.
 */
export const orgComposer = new Composer<Context>();

const RES_CALLBACK = /^(?:v|vc|vb|qx|qc|qr)\|([0-9a-f-]{36})/;
const ORG_CALLBACK = /^(?:gswitch|gate|reset)\|[^|]*\|?.*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

async function orgOfResolution(id: string): Promise<string | null> {
  const { data, error } = await rawDb.from("resolutions").select("org_id").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? String(data.org_id) : null;
}

/** Organisations a person administers (all of them for platform admins). */
async function adminOrgs(userId: number): Promise<Org[]> {
  const orgs = await listOrgs();
  if (isPlatformAdmin(userId)) return orgs;
  const mine = new Set((await userOrgIds(userId)).admin);
  return orgs.filter((o) => mine.has(o.id));
}

async function resolve(ctx: Context): Promise<string | null> {
  const from = ctx.from;
  const data = ctx.callbackQuery?.data;
  if (data) {
    const r = RES_CALLBACK.exec(data);
    if (r) return orgOfResolution(r[1]);
    const o = ORG_CALLBACK.exec(data);
    if (o && from) {
      // Only an admin of that organisation may act in it from a button.
      const admins = await adminOrgs(from.id);
      if (admins.some((x) => x.id === o[1])) return o[1];
    }
    const gate = /^gate\|\w+\|(-?\d+)\|/.exec(data);
    if (gate) return (await orgByGroupChat(Number(gate[1])))?.id ?? null;
    const pick = /^org\|([0-9a-f-]{36})$/.exec(data);
    if (pick) return null; // handled below, outside any organisation
  }

  const chat = ctx.chat ?? ctx.myChatMember?.chat ?? ctx.chatMember?.chat ?? ctx.chatJoinRequest?.chat;
  if (chat && (chat.type === "group" || chat.type === "supergroup")) {
    const org = await orgByGroupChat(chat.id);
    if (org) return org.id;
    const orgs = await listOrgs();
    if (orgs.length === 1) return orgs[0].id; // only one organisation: every group is about it
    // An unlinked group: it can only become an organisation's group through one of its admins.
    if (from) {
      const mine = await adminOrgs(from.id);
      if (mine.length === 1) return mine[0].id;
    }
    return null;
  }

  if (!from) return null;
  // Invitation deep link: the code says which organisation.
  const text = ctx.message?.text ?? "";
  const inv = /^\/start\s+inv_(\S+)/.exec(text);
  if (inv) {
    const member = await findByToken(decodeURIComponent(inv[1]));
    if (member) return member.org_id;
  }
  const inLogin = sessionOrgId(from.id);
  if (inLogin) return inLogin;
  return resolveUserOrg(from.id);
}

/** Ask which organisation a private message is about. */
async function askWhichOrg(ctx: Context, orgIds: string[]): Promise<void> {
  const kb = new InlineKeyboard();
  for (const id of orgIds) {
    const org = await getOrg(id);
    if (org) kb.text(org.name_en, `org|${org.id}`).row();
  }
  await ctx.reply("You take part in several organisations. Which one is this about? (You can switch any time with /org.)", { reply_markup: kb });
}

/** A group nobody linked yet, added by someone who administers several organisations: ask which one. */
const askedGroups = new Map<number, number>();
const ASK_AGAIN_MS = 10 * 60 * 1000;

async function askWhichOrgForGroup(ctx: Context): Promise<void> {
  const chat = ctx.myChatMember?.chat;
  const from = ctx.myChatMember?.from;
  const status = ctx.myChatMember?.new_chat_member.status;
  if (!chat || !from || (status !== "administrator" && status !== "member")) return;
  const title = ("title" in chat ? chat.title : undefined) ?? String(chat.id);
  const mine = await adminOrgs(from.id);
  if (mine.length < 2) {
    // Added by someone who administers no organisation: the group stays unclaimed.
    console.log(`Added to "${title}" (${chat.id}) by ${from.id}, who administers no organisation — not linking it`);
    return;
  }
  // Added, then promoted a moment later: ask once, not twice.
  const last = askedGroups.get(chat.id);
  if (last && Date.now() - last < ASK_AGAIN_MS) return;
  askedGroups.set(chat.id, Date.now());
  const kb = new InlineKeyboard();
  for (const org of mine) kb.text(org.name_en, `gswitch|${chat.id}|${org.id}`).row();
  // Ask in the group, where the person who just added the bot is looking; the
  // set-up (topics, buttons, group name) waits for this answer.
  const question =
    `👥 <b>Which organisation is this group for?</b>\n` +
    `Tap it below. I then name the group after it and set up the sign-in and commands topics.\n\n` +
    `<i>Only an administrator of that organisation can choose.</i>`;
  try {
    await ctx.api.sendMessage(chat.id, question, { parse_mode: "HTML", reply_markup: kb });
    console.log(`Added to "${title}" (${chat.id}) — asked in the group which organisation it is for`);
    return;
  } catch {
    // Not allowed to post there (e.g. added without the right to send messages): ask privately instead.
  }
  try {
    await ctx.api.sendMessage(from.id, `👥 I was added to <b>${escapeHtml(title)}</b>. Which organisation is this group for?`, { parse_mode: "HTML", reply_markup: kb });
    console.log(`Added to "${title}" (${chat.id}) — asked ${from.id} privately which organisation it is for`);
  } catch (err) {
    console.error(`Added to "${title}" (${chat.id}) but could not ask which organisation it is for:`, (err as Error).message);
  }
}

orgComposer.use(async (ctx: Context, next: NextFunction) => {
  // Choosing an organisation for the private chat.
  const pick = ctx.callbackQuery?.data ? /^org\|([0-9a-f-]{36})$/.exec(ctx.callbackQuery.data) : null;
  if (pick && ctx.from) {
    const mine = await userOrgIds(ctx.from.id);
    const allowed = new Set([...mine.member, ...mine.admin]);
    const org = await getOrg(pick[1]);
    if (!org || !allowed.has(org.id)) {
      await ctx.answerCallbackQuery({ text: "You are not part of that organisation.", show_alert: true });
      return;
    }
    await setActiveOrg(ctx.from.id, org.id);
    await ctx.answerCallbackQuery({ text: `Now: ${org.name_en}` });
    await ctx.editMessageText(`✅ This chat is now about <b>${escapeHtml(brandedName(org))}</b>. Send /org to switch.`, { parse_mode: "HTML" });
    return;
  }

  // Removed from a group: the next time it is added, ask about the organisation again.
  const gone = ctx.myChatMember?.new_chat_member.status;
  if (ctx.myChatMember && (gone === "left" || gone === "kicked")) askedGroups.delete(ctx.myChatMember.chat.id);
  // A group without Topics: warn, tell whoever added the bot, and leave.
  if (await refuseGroupWithoutTopics(ctx)) return;

  const orgId = await resolve(ctx);

  if (!orgId && ctx.chat?.type === "private" && ctx.from && (ctx.message || ctx.callbackQuery)) {
    const mine = await userOrgIds(ctx.from.id);
    const all = [...new Set([...mine.member, ...mine.admin])];
    if (all.length > 1) {
      await askWhichOrg(ctx, all);
      if (ctx.callbackQuery) await ctx.answerCallbackQuery();
      return;
    }
  }
  if (!orgId && ctx.myChatMember) await askWhichOrgForGroup(ctx);
  return withOrg(orgId, () => next());
});

/** /org — switch which organisation the private chat is about. */
orgComposer.chatType("private").command("org", async (ctx) => {
  const mine = await userOrgIds(ctx.from.id);
  const all = [...new Set([...mine.member, ...mine.admin])];
  if (all.length === 0) {
    await ctx.reply("You are not registered in any organisation yet. Register with the invitation code you received: send /start.");
    return;
  }
  await askWhichOrg(ctx, all);
});
