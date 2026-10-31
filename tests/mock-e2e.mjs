/**
 * End-to-end mock-up test. Runs the real application (router, bot handlers,
 * Mini App API, services) against:
 *   - an in-memory fake of the database client (tests/fake-supabase.mjs, via loader hook),
 *     or a real PostgreSQL when TEST_DATABASE_URL is set (the schema is applied
 *     and ALL TABLES ARE TRUNCATED first — use a throwaway database)
 *   - a local mock of the Telegram Bot API (records every call the bot makes)
 *
 * Scenario: secure setup → group & topics ("rooms") learned → credentials →
 * member registration (app + chat, lockout, conflicts) → resolutions announced
 * into different topics → voting (app + chat buttons, secret vs open ballot,
 * double-vote guard) → close / auto-close → results in the right topic →
 * reports, broadcast, admin management, audit trail.
 *
 * Run:  npm run test:mock
 *       npm run test:pg     (TEST_DATABASE_URL=postgres://... — real database)
 */
import { register } from "node:module";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
process.chdir(root);

// ---------------------------------------------------------------- mock Telegram
const BOT_TOKEN = "777000:MOCKTOKENabcdef";
const BOT = { id: 777000, is_bot: true, first_name: "ESA Voting (mock)", username: "esa_mock_bot" };
let botMembership = "administrator"; // what getChatMember reports for the bot in the group
// Member permissions of the group as Telegram would report them (all on for a new group).
let chatPermissions = { can_send_messages: true, can_send_polls: true, can_change_info: true, can_invite_users: true, can_pin_messages: true, can_manage_topics: true };
let lockRights = true; // whether the bot holds "Ban users" (setChatPermissions succeeds)
let nextThreadId = 44; // forum topics the bot creates: 44 = sign-in, 45 = commands
const tgCalls = [];
let webhookUrl = "";
let nextMessageId = 100;

const tgServer = createServer(async (req, res) => {
  const m = /^\/bot([^/]+)\/(\w+)/.exec(req.url ?? "");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!m || m[1] !== BOT_TOKEN) {
    res.writeHead(401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }));
  }
  const method = m[2];
  let body = {};
  if ((req.headers["content-type"] ?? "").includes("application/json")) {
    try { body = JSON.parse(raw); } catch { body = {}; }
  } else {
    // multipart (file uploads): pull the simple fields out
    for (const f of ["chat_id", "caption", "message_thread_id"]) {
      const r = new RegExp(`name="${f}"\\r?\\n\\r?\\n([^\\r\\n]*)`).exec(raw);
      if (r) body[f] = r[1];
    }
    const fn = /filename="?([^"\r\n]+)"?/.exec(raw);
    if (fn) body.filename = fn[1];
    body.filenames = [...raw.matchAll(/filename="?([^"\r\n]+)"?/g)].map((x) => x[1]);
    body.pdf_count = raw.split("%PDF-").length - 1;
    body.uri_count = raw.split("/URI").length - 1; // link annotations in the PDF(s)
    const media = new RegExp(`name="media"\\r?\\n\\r?\\n([^\\r\\n]*)`).exec(raw);
    if (media) { try { body.media = JSON.parse(media[1]); } catch { /* not JSON */ } }
    body.bytes = raw.length;
    body.is_pdf = raw.includes("%PDF-");
  }
  tgCalls.push({ method, body });
  let result = true;
  switch (method) {
    case "getMe": result = BOT; break;
    case "getChatMember":
      if (botMembership === "gone") {
        // What Telegram really answers once the bot has been removed from the group.
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot is not a member of the supergroup chat" }));
        return;
      }
      result = { status: botMembership, user: BOT, can_manage_topics: true, can_delete_messages: true, can_pin_messages: true, can_restrict_members: true };
      break;
    case "getChat":
      result = { id: Number(body.chat_id), type: "supergroup", title: GROUP.title, is_forum: true, permissions: { ...chatPermissions } };
      break;
    case "createForumTopic":
      result = { message_thread_id: nextThreadId++, name: body.name, icon_color: 0x6fb9f0 };
      break;
    case "createChatInviteLink":
      result = { invite_link: "https://t.me/+esa-test-link", creator: BOT, creates_join_request: Boolean(body.creates_join_request), is_primary: false, is_revoked: false };
      break;
    case "setChatPermissions":
      if (!lockRights) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: not enough rights to change chat permissions" }));
        return;
      }
      chatPermissions = { ...body.permissions };
      break;
    case "setWebhook": webhookUrl = body.url; break;
    case "deleteWebhook": webhookUrl = ""; break;
    case "getWebhookInfo": result = { url: webhookUrl, has_custom_certificate: false, pending_update_count: 0 }; break;
    case "sendMessage":
    case "sendDocument":
      result = { message_id: nextMessageId++, date: Math.floor(Date.now() / 1000), chat: { id: Number(body.chat_id), type: Number(body.chat_id) < 0 ? "supergroup" : "private" }, text: body.text ?? "" };
      break;
    case "editForumTopic":
    case "editGeneralForumTopic":
      // Simulate a bot without the "Manage topics" right for one particular name.
      if (String(body.name ?? "").startsWith("Blocked")) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: not enough rights to manage topics" }));
        return;
      }
      break;
    default: result = true;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, result }));
});
await new Promise((r) => tgServer.listen(0, r));
const tgRoot = `http://127.0.0.1:${tgServer.address().port}`;

// ---------------------------------------------------------------- environment
Object.assign(process.env, {
  BOT_TOKEN,
  TELEGRAM_API_ROOT: tgRoot,
  DATABASE_URL: process.env.TEST_DATABASE_URL || "postgres://fake:fake@127.0.0.1:1/fake",
  ADMIN_TELEGRAM_IDS: "1001",
  PUBLIC_URL: "https://esa.test",
  WEBHOOK_SECRET: "wh-secret-123",
  VERCEL: "1",
  TZ_OFFSET_MINUTES: "180",
  TZ_LABEL: "EAT",
});
delete process.env.RESEND_API_KEY;

const REAL = Boolean(process.env.TEST_DATABASE_URL);
if (!REAL) register("./hooks.mjs", import.meta.url);
const { handleHttp } = await import(pathToFileURL(resolve(root, "dist/http/router.js")).href);
const realDb = REAL ? await import(pathToFileURL(resolve(root, "dist/db.js")).href) : null;
const TABLES = ["members", "resolutions", "ballots", "votes", "vote_activations", "audit_log", "app_settings", "chat_topics", "admins", "councils", "group_people", "pending_invitations", "user_active_org", "organizations"];
if (REAL) {
  await realDb.ensureSchema();
  await realDb.rawDb.exec(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  console.log(`Running against PostgreSQL: ${process.env.TEST_DATABASE_URL.replace(/\/\/.*@/, "//***@")}`);
}
const db = () => globalThis.__fakeSupabase;
/** Raw rows of a table (fake: in-memory array; real: SELECT *). */
async function rows(table) {
  if (!REAL) return db().tables[table];
  const { data, error } = await realDb.rawDb.from(table).select("*");
  if (error) throw error;
  return data;
}
/** Pretend a table is missing (fake: flag; real: rename it away and back). */
async function hideTable(table, hidden) {
  if (!REAL) { hidden ? db().missing.add(table) : db().missing.delete(table); return; }
  await realDb.rawDb.exec(hidden ? `ALTER TABLE ${table} RENAME TO ${table}_hidden` : `ALTER TABLE ${table}_hidden RENAME TO ${table}`);
}

const appServer = createServer((req, res) => handleHttp(req, res));
await new Promise((r) => appServer.listen(0, r));
const base = `http://127.0.0.1:${appServer.address().port}`;

// ---------------------------------------------------------------- helpers
const results = [];
function check(name, ok, info) { results.push({ name, ok: Boolean(ok), info: ok ? "" : String(info ?? "") }); }
function eq(name, actual, expected) { check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`); }

function initData(user) {
  const params = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: "AAE" + user.id, user: JSON.stringify(user) };
  const pairs = Object.entries(params).map(([k, v]) => `${k}=${v}`).sort();
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  params.hash = createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");
  return new URLSearchParams(params).toString();
}
const USERS = {
  admin: { id: 1001, first_name: "Admin", username: "esa_admin" },
  abebe: { id: 2001, first_name: "Abebe" },
  sara: { id: 2002, first_name: "Sara" },
  dawit: { id: 2003, first_name: "Dawit" },
  guest: { id: 2004, first_name: "Guest" },
  newAdmin: { id: 3001, first_name: "Second Admin" },
  delegate: { id: 2005, first_name: "Delegate" },
  delegate2: { id: 2006, first_name: "Delegate Two" },
  delegate3: { id: 2007, first_name: "Delegate Three" },
};

// The organisation the Mini App asks for (X-Org-Id); set once the scenario's organisation exists.
let defaultOrg = null;
async function api(method, path, user, body, org = defaultOrg) {
  const res = await fetch(base + "/api/app" + path, {
    method,
    headers: { "content-type": "application/json", ...(user ? { authorization: "tma " + initData(user) } : {}), ...(org ? { "x-org-id": org } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}
let updateId = 1;
async function update(obj, secret = "wh-secret-123") {
  const res = await fetch(base + "/telegram", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify({ update_id: updateId++, ...obj }),
  });
  return res.status;
}
const GROUP = { id: -1000500, type: "supergroup", title: "ESA General Assembly 2026", is_forum: true };
const priv = (u) => ({ id: u.id, type: "private", first_name: u.first_name });
const from = (u) => ({ id: u.id, is_bot: false, first_name: u.first_name });
let msgId = 1;
function textMessage(u, text) {
  const entities = text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] : [];
  return { message: { message_id: msgId++, date: Math.floor(Date.now() / 1000), chat: priv(u), from: from(u), text, entities } };
}
function callback(u, data) {
  return { callback_query: { id: "cq" + msgId, from: from(u), chat_instance: "ci", data, message: { message_id: msgId++, date: Math.floor(Date.now() / 1000), chat: priv(u), from: BOT, text: "ballot" } } };
}
const calls = (method, pred = () => true) => tgCalls.filter((c) => c.method === method && pred(c.body));
const sentTo = (chatId, threadId) => calls("sendMessage", (b) => Number(b.chat_id) === chatId && (threadId === undefined || (b.message_thread_id ?? null) === threadId));
const lastTextTo = (chatId) => { const c = sentTo(chatId); return c.length ? c[c.length - 1].body.text : ""; };

// ================================================================= SCENARIO
try {
  // ---- 1. Secure setup ----------------------------------------------------
  let r = await fetch(base + "/api/setup?key=wrong");
  eq("setup: wrong key rejected", r.status, 401);
  r = await fetch(base + "/api/setup?key=wh-secret-123");
  const setup = await r.json();
  eq("setup: succeeds with secret", r.status, 200);
  eq("setup: webhook registered at /telegram", webhookUrl, "https://esa.test/telegram");
  const sw = calls("setWebhook")[0];
  eq("setup: webhook carries secret token", sw?.body.secret_token, "wh-secret-123");
  check("setup: webhook allows my_chat_member updates", sw?.body.allowed_updates?.includes("my_chat_member"));
  const menu = calls("setChatMenuButton")[0];
  eq("setup: menu button opens the Mini App", menu?.body.menu_button?.web_app?.url, "https://esa.test/app/");
  check("setup: commands registered", calls("setMyCommands").length >= 1);
  eq("setup: bot display name applied by the app", calls("setMyName")[0]?.body?.name, "Kene Voting System");
  check("setup: bot descriptions applied by the app", calls("setMyShortDescription").length >= 1 && calls("setMyDescription").length >= 1);
  eq("setup: reports app url", setup.app_url, "https://esa.test/app/");

  eq("webhook: wrong secret rejected", await update(textMessage(USERS.guest, "/start"), "nope"), 401);
  eq("webhook: no secret rejected", await (await fetch(base + "/telegram", { method: "POST", body: "{}" })).status, 401);

  // ---- Organisation: Kene Voting System hosts several; the scenario runs in one ----
  r = await api("POST", "/orgs", USERS.guest, { name_en: "Intruders", short_code: "INT" });
  eq("org: only platform admins create organisations", r.status, 403);
  r = await api("POST", "/orgs", USERS.admin, { name_en: "Ethiopia Scout Association", name_am: "የኢትዮጵያ ስካውት ማኅበር", short_code: "ESA", assembly_en: "General Assembly 2026", office_en: "National Office" });
  const ORG = r.json?.org;
  check("org: platform admin creates the organisation", r.status === 200 && ORG?.id && ORG.branded === "Ethiopia Scout Association (Kene Voting System)" && ORG.role === "admin", JSON.stringify(r.json));
  defaultOrg = ORG.id;

  // Roles & auth
  r = await api("GET", "/me", USERS.admin);
  eq("auth: env admin recognised", r.json?.role, "admin");
  r = await api("GET", "/me", USERS.guest);
  eq("auth: unknown user is a guest", r.json?.role, "guest");
  r = await api("GET", "/dashboard", USERS.guest);
  eq("auth: guest cannot open admin dashboard", r.status, 403);
  r = await api("GET", "/me", null);
  eq("auth: missing initData rejected", r.status, 401);
  const forged = initData(USERS.admin).replace(/hash=[0-9a-f]+/, "hash=" + "0".repeat(64));
  r = await fetch(base + "/api/app/me", { headers: { authorization: "tma " + forged } });
  eq("auth: forged signature rejected", r.status, 401);

  // Setup diagnostics
  await hideTable("admins", true);
  r = await api("GET", "/setup", USERS.admin);
  check("setup: missing table detected", r.json?.db?.ok === false && r.json.db.missing.includes("admins"), JSON.stringify(r.json?.db));
  await hideTable("admins", false);
  r = await api("GET", "/setup", USERS.admin);
  check("setup: database healthy after migration", r.json?.db?.ok === true);
  check("setup: webhook reported ok", r.json?.webhook?.ok === true, JSON.stringify(r.json?.webhook));
  check("setup: Telegram API round trip reported", typeof r.json?.telegram_api_ms === "number" && r.json.telegram_api_ms >= 0, JSON.stringify(r.json?.telegram_api_ms));

  // ---- 2. Group and topics ("rooms") learned from Telegram ------------------
  await update({ my_chat_member: { chat: GROUP, from: from(USERS.admin), date: 1, old_chat_member: { status: "left", user: BOT }, new_chat_member: { status: "administrator", user: BOT, can_be_edited: false, is_anonymous: false, can_manage_chat: true, can_delete_messages: true, can_manage_video_chats: false, can_restrict_members: false, can_promote_members: false, can_change_info: false, can_invite_users: false, can_post_stories: false, can_edit_stories: false, can_delete_stories: false } } });
  const topicMsg = (threadId, name) => ({ message: { message_id: msgId++, date: 1, chat: GROUP, from: from(USERS.admin), message_thread_id: threadId, is_topic_message: true, forum_topic_created: { name, icon_color: 0 } } });
  await update(topicMsg(11, "Day 1 — Resolutions"));
  await update(topicMsg(22, "JOTA-JOTI"));
  // a plain message in a topic the bot has not seen created (name unknown)
  await update({ message: { message_id: msgId++, date: 1, chat: GROUP, from: from(USERS.admin), message_thread_id: 33, is_topic_message: true, text: "hello" } });
  r = await api("GET", "/setup", USERS.admin);
  eq("rooms: group linked", r.json?.group?.chat_id, GROUP.id);
  check("signin: a Register / Sign in topic was created when the bot became admin", calls("createForumTopic", (b) => Number(b.chat_id) === GROUP.id && /Sign in/.test(b.name)).length === 1, JSON.stringify(calls("createForumTopic").map((c) => c.body)));
  check("signin: card posted in that topic with a register button", sentTo(GROUP.id, 44).some((c) => /Register with your code/.test(c.body.text) && JSON.stringify(c.body.reply_markup).includes("start=register")), JSON.stringify(sentTo(GROUP.id, 44).map((c) => c.body.text)));
  check("signin: card pinned", calls("pinChatMessage", (b) => Number(b.chat_id) === GROUP.id).length >= 1);
  check("signin: admins told where members sign in", /Register \/ Sign in/.test(lastTextTo(1001)) && /cannot check the people already inside/.test(lastTextTo(1001)), lastTextTo(1001));
  r = await api("POST", "/setup/group/signin", USERS.admin);
  check("signin: re-posted from Setup into the same topic", r.json?.thread_id === 44 && r.json.note === null && sentTo(GROUP.id, 44).length === 2 && calls("createForumTopic", (b) => /Sign in/.test(b.name)).length === 1, JSON.stringify(r.json));
  check("commands: a Commands topic was created with the bilingual reference pinned", calls("createForumTopic", (b) => /Commands/.test(b.name)).length === 1 && sentTo(GROUP.id, 45).some((c) => /\/vote — Show/.test(c.body.text) && /\/vote — ለድምፅ/.test(c.body.text) && c.body.reply_markup?.keyboard?.length === 1 && c.body.reply_markup.keyboard[0].map((k) => k.text).join("|") === "🗳 Vote|📋 Status|📝 Register|❔ Help") && calls("pinChatMessage").length >= 2, JSON.stringify(sentTo(GROUP.id, 45).map((c) => c.body.text.slice(0, 40))));
  check("commands: command buttons also shown in General", sentTo(GROUP.id, null).some((c) => /buttons below the message box/.test(c.body.text) && c.body.reply_markup?.keyboard), JSON.stringify(sentTo(GROUP.id, null).map((c) => c.body.text.slice(0, 40))));
  check("commands: '/' menu registered for the group in English and Amharic", calls("setMyCommands", (b) => b.scope?.type === "chat" && Number(b.scope.chat_id) === GROUP.id && !b.language_code && b.commands.some((c) => c.command === "vote")).length === 1 && calls("setMyCommands", (b) => b.scope?.type === "chat" && Number(b.scope.chat_id) === GROUP.id && b.language_code === "am" && /ድምፅ/.test(b.commands[0].description)).length === 1, JSON.stringify(calls("setMyCommands").map((c) => c.body.scope)));
  r = await api("POST", "/setup/group/commands", USERS.admin);
  check("commands: re-posted from Setup", r.json?.thread_id === 45 && r.json.note === null && sentTo(GROUP.id, 45).length === 2, JSON.stringify(r.json));
  await update({ message: { message_id: msgId++, date: 1, chat: GROUP, from: from(USERS.guest), message_thread_id: 11, is_topic_message: true, text: "/vote", entities: [{ type: "bot_command", offset: 0, length: 5 }] } });
  check("commands: /vote in a topic by an unregistered person → register pointer in that topic", sentTo(GROUP.id, 11).some((c) => /not registered yet/.test(c.body.text) && JSON.stringify(c.body.reply_markup).includes("start=register")), JSON.stringify(sentTo(GROUP.id, 11).map((c) => c.body.text.slice(0, 50))));
  const before11 = sentTo(GROUP.id, 11).length;
  await update({ message: { message_id: msgId++, date: 1, chat: GROUP, from: from(USERS.guest), message_thread_id: 11, is_topic_message: true, text: "📋 Status" } });
  check("commands: a reply-keyboard label works like the command", sentTo(GROUP.id, 11).length === before11 + 1 && /not registered yet/.test(lastTextTo(GROUP.id)), JSON.stringify(sentTo(GROUP.id, 11).map((c) => c.body.text.slice(0, 50))));
  await update({ message: { message_id: msgId++, date: 1, chat: GROUP, from: from(USERS.guest), message_thread_id: 11, is_topic_message: true, text: "hello everyone" } });
  eq("commands: ordinary chat in a topic gets no reply", sentTo(GROUP.id, 11).length, before11 + 1);
  r = await api("GET", "/setup", USERS.admin);
  check("lock: member permissions locked when the bot was made admin", calls("setChatPermissions", (b) => Number(b.chat_id) === GROUP.id && b.permissions?.can_invite_users === false && b.permissions?.can_manage_topics === false && b.permissions?.can_change_info === false && b.permissions?.can_pin_messages === false && b.permissions?.can_send_messages === true && b.use_independent_chat_permissions === true).length === 1, JSON.stringify(calls("setChatPermissions").map((c) => c.body)));
  check("lock: Setup reports the group as locked", r.json?.group_lock?.locked === true && r.json?.group_rights?.can_restrict_members === true, JSON.stringify([r.json?.group_lock, r.json?.group_rights]));
  chatPermissions.can_invite_users = true; // someone re-enabled it by hand
  r = await api("GET", "/setup", USERS.admin);
  eq("lock: Setup lists what members can still do", r.json?.group_lock, { locked: false, open: ["can_invite_users"] });
  lockRights = false;
  r = await api("POST", "/setup/group/lock", USERS.admin);
  check("lock: without the Ban users right the app says so", r.status === 200 && r.json?.ok === false && r.json.code === "no_rights", JSON.stringify(r.json));
  lockRights = true;
  r = await api("POST", "/setup/group/lock", USERS.admin);
  check("lock: re-applied from Setup", r.json?.ok === true && r.json.lock?.locked === true, JSON.stringify(r.json));
  r = await api("GET", "/setup", USERS.admin);
  check("rooms: bot's rights in the group reported", r.json?.group_rights?.is_admin === true && r.json?.group_rights?.can_manage_topics === true, JSON.stringify(r.json?.group_rights));
  const topicNames = Object.fromEntries((r.json?.topics ?? []).map((t) => [t.thread_id, t.name]));
  eq("rooms: General + sign-in + commands + 3 topics known", Object.keys(topicNames).length, 6);
  eq("rooms: sign-in and commands topics listed by name", [topicNames[44], topicNames[45]], ["📝 Register / Sign in", "📖 Commands / ትዕዛዞች"]);
  eq("rooms: topic names learned", [topicNames[0], topicNames[11], topicNames[22], topicNames[33]], ["General", "Day 1 — Resolutions", "JOTA-JOTI", null]);
  r = await api("PATCH", "/setup/topics/" + GROUP.id + "/33", USERS.admin, { name: "Announcements" });
  eq("rooms: topic renamed from app", r.status, 200);
  check("rooms: rename pushed to the Telegram topic", r.json?.telegram === true && calls("editForumTopic", (b) => Number(b.message_thread_id) === 33 && b.name === "Announcements").length === 1, JSON.stringify(r.json));
  r = await api("PATCH", "/setup/topics/" + GROUP.id + "/0", USERS.admin, { name: "General" });
  check("rooms: General topic renamed via editGeneralForumTopic", r.json?.telegram === true && calls("editGeneralForumTopic", (b) => b.name === "General").length === 1);
  r = await api("PATCH", "/setup/topics/" + GROUP.id + "/22", USERS.admin, { name: "Blocked rename" });
  check("rooms: without Manage-topics right the name is kept as a label", r.status === 200 && r.json?.telegram === false && r.json?.code === "no_rights" && /rights/.test(r.json?.reason ?? ""), JSON.stringify(r.json));
  r = await api("GET", "/setup", USERS.admin);
  eq("rooms: label stored although Telegram refused", (r.json?.topics ?? []).find((t) => t.thread_id === 22)?.name, "Blocked rename");
  r = await api("PATCH", "/setup/topics/" + GROUP.id + "/22", USERS.admin, { name: "JOTA-JOTI" });
  eq("rooms: topic name restored", r.json?.telegram, true);
  r = await api("POST", "/setup/topics", USERS.admin, { chat_id: 1, thread_id: 1, name: "Phantom" });
  eq("rooms: adding a topic under a chat id that is not the linked group is rejected", r.status, 400);
  r = await api("POST", "/setup/topics", USERS.admin, { chat_id: GROUP.id, thread_id: 44, name: "Added by ID" });
  eq("rooms: adding a topic by ID in the linked group works", r.status, 200);
  r = await api("DELETE", "/setup/topics/" + GROUP.id + "/44", USERS.admin);
  eq("rooms: topic removed from the list again", r.status, 200);
  r = await api("POST", "/setup/test-message", USERS.admin, { chat_id: GROUP.id, thread_id: 22 });
  check("rooms: test message lands in JOTA-JOTI topic", r.status === 200 && sentTo(GROUP.id, 22).length === 1);

  // ---- 3. Credentials -----------------------------------------------------
  r = await api("POST", "/members/generate", USERS.admin, { people: [{ name: "Abebe Kebede", region: "Addis Ababa" }, { name: "Sara Tesfaye", region: "Oromia" }, { name: "Dawit Alemu", region: "Amhara" }], prefix: "ESA-2026" });
  eq("credentials: 3 generated", r.json?.rows?.length, 3);
  const creds = r.json.rows;
  check("credentials: token format ESA-2026-XXXXX", creds.every((c) => /^ESA-2026-[A-HJ-NP-Z2-9]{5}$/.test(c.token_id)), creds.map((c) => c.token_id).join());
  check("credentials: 10-char passwords", creds.every((c) => c.password.length === 10));
  check("credentials: only hashes stored", (await rows("members")).every((m) => m.password_hash.startsWith("$2") && !creds.some((c) => c.password === m.password_hash)));
  r = await api("POST", "/members/credentials-file", USERS.admin, { rows: creds });
  check("credentials: CSV delivered to admin chat only", r.status === 200 && calls("sendDocument", (b) => Number(b.chat_id) === 1001 && /credentials/.test(b.filename ?? "")).length === 1);

  // ---- Councils & invitations (QR / PDF flow)
  r = await api("GET", "/councils", USERS.admin);
  eq("councils: empty at start", [r.status, r.json?.items?.length], [200, 0]);
  r = await api("POST", "/councils", USERS.admin, { name: "Addis Ababa Regional Council", seats: 3 });
  const AARC = r.json?.council;
  eq("councils: created with a code derived from the name", [r.status, r.json?.created, AARC?.code, AARC?.seats], [200, true, "AARC", 3]);
  r = await api("POST", "/councils", USERS.admin, { name: "addis ababa regional council", seats: 2 });
  eq("councils: duplicate name rejected (case-insensitive)", [r.status, r.json?.code], [409, "exists"]);
  r = await api("POST", "/councils", USERS.admin, { name: "Addis Ababa Regional Council", seats: 5, upsert: true });
  eq("councils: upsert reuses the council and raises seats", [r.json?.created, r.json?.council?.id === AARC.id, r.json?.council?.seats], [false, true, 5]);
  r = await api("POST", "/councils", USERS.admin, { name: "Oromia", seats: 2, vote_weight: 2 });
  const ORO = r.json?.council;
  eq("councils: second council code, 2 votes per delegate", [ORO?.code, ORO?.vote_weight, ORO?.total_votes], ["ORO", 2, 4]);
  r = await api("POST", "/councils", USERS.admin, { name: "Oromia", seats: 2, vote_weight: 0 });
  eq("councils: vote weight below 1 rejected", r.status, 400);
  r = await api("POST", "/councils/" + AARC.id + "/invitations", USERS.admin, { names: ["Hana Girma", "", "Yonas Bekele"] });
  const inv = r.json?.rows ?? [];
  eq("invitations: 3 issued for the council", [r.status, inv.length, r.json?.council?.issued], [200, 3, 3]);
  check("invitations: tokens carry the council code and seat numbers 1..3", inv.every((x) => /^AARC-[A-HJ-NP-Z2-9]{5}$/.test(x.token_id)) && inv.map((x) => x.seat_no).join() === "1,2,3", JSON.stringify(inv.map((x) => [x.token_id, x.seat_no])));
  eq("invitations: anonymous seat has no name", [inv[0].full_name, inv[1].full_name], ["Hana Girma", null]);
  const invRows = await rows("members");
  check("invitations: stored with council_id and region = council name", inv.every((x) => invRows.some((m) => m.token_id === x.token_id && m.council_id === AARC.id && m.region === AARC.name && m.password_hash.startsWith("$2"))));
  r = await api("POST", "/councils/" + ORO.id + "/invitations", USERS.admin, { count: 2 });
  const oroInv = r.json?.rows ?? [];
  eq("invitations: issued by count", [oroInv.length, oroInv.map((x) => x.seat_no).join()], [2, "1,2"]);
  check("invitations: delegates inherit the council vote weight", (await rows("members")).filter((m) => m.council_id === ORO.id).every((m) => m.vote_weight === 2));
  r = await api("GET", "/councils/" + AARC.id, USERS.admin);
  check("invitations: council page lists them with deep links", r.json?.invitations?.length === 3 && r.json.invitations.every((m) => m.link === "https://t.me/esa_mock_bot?start=inv_" + m.token_id && m.telegram_user_id === null), JSON.stringify(r.json?.invitations?.[0]));
  r = await api("POST", "/councils/" + AARC.id + "/invitations-pdf", USERS.admin, { rows: inv });
  const pdfCall = calls("sendDocument", (b) => Number(b.chat_id) === 1001 && /invitations-aarc/.test(b.filename ?? "") && /\.pdf$/.test(b.filename ?? ""));
  check("invitations: PDF sent to the admin chat", r.status === 200 && pdfCall.length === 1 && pdfCall[0].body.is_pdf && pdfCall[0].body.bytes > 10000, JSON.stringify([r.status, r.json, pdfCall.map((c) => c.body)]));
  check("invitations: every invitation has clickable links (QR, register button, link text)", pdfCall[0].body.uri_count >= 3 * inv.length, JSON.stringify(pdfCall[0].body.uri_count));
  r = await api("POST", "/councils/" + AARC.id + "/invitations-pdf", USERS.admin, { rows: inv, separate: true });
  const albums = calls("sendMediaGroup", (b) => Number(b.chat_id) === 1001);
  check("invitations: one PDF per delegate, sent as one album", r.status === 200 && r.json?.files?.length === inv.length && albums.length === 1 && albums[0].body.pdf_count === inv.length && albums[0].body.media?.length === inv.length && albums[0].body.media.every((m) => m.type === "document"), JSON.stringify([r.status, r.json, albums.map((c) => [c.body.pdf_count, c.body.media?.length])]));
  check("invitations: each file is named after its seat and delegate", r.json.files.every((f, i) => f.startsWith(`esa-invitation-aarc-${String(inv[i].seat_no ?? i + 1).padStart(2, "0")}`) && f.endsWith(".pdf")) && r.json.files.some((f) => /Hana-Girma/.test(f)), JSON.stringify(r.json.files));
  check("invitations: only the last file carries the caption", albums[0].body.media.filter((m) => m.caption).length === 1 && /one PDF per delegate/.test(albums[0].body.media.at(-1).caption ?? ""), JSON.stringify(albums[0].body.media.map((m) => Boolean(m.caption))));
  r = await api("DELETE", "/councils/" + AARC.id, USERS.admin);
  eq("councils: cannot delete once invitations exist", [r.status, r.json?.code], [409, "has_members"]);
  r = await api("POST", "/councils", USERS.admin, { name: "Temporary", seats: 1 });
  r = await api("DELETE", "/councils/" + r.json.council.id, USERS.admin);
  eq("councils: empty council can be deleted", r.status, 200);
  r = await api("GET", "/councils", USERS.admin);
  eq("councils: list with counts", r.json?.items?.map((c) => [c.code, c.issued, c.registered]), [["AARC", 3, 0], ["ORO", 2, 0]]);

  // Deep link: /start inv_<token> → bot recognises the code and waits for the password
  await update(textMessage(USERS.delegate, "/start inv_" + inv[0].token_id));
  check("invitation(chat): /start inv_<code> recognises the invitation", /Invitation code/.test(lastTextTo(2005)) && new RegExp(inv[0].token_id).test(lastTextTo(2005)), lastTextTo(2005));
  check("invitation(chat): reply carries an app button with the code pre-filled", sentTo(2005).some((c) => c.body.reply_markup?.inline_keyboard?.some((row) => row.some((b) => b.web_app?.url === "https://esa.test/app/?inv=" + inv[0].token_id))));
  await update(textMessage(USERS.delegate, inv[0].password));
  check("invitation(chat): password completes registration", /Registration complete/.test(sentTo(2005).map((c) => c.body.text).join("\n")));
  check("invitation(chat): completion message carries a button into the assembly group", sentTo(2005).some((c) => /Registration complete/.test(c.body.text) && JSON.stringify(c.body.reply_markup || {}).includes("https://t.me/+esa-test-link")), JSON.stringify(sentTo(2005).filter((c) => /Registration complete/.test(c.body.text)).map((c) => c.body.reply_markup)));
  check("invitation(chat): the group link asks to join by request (gate approves registered members)", calls("createChatInviteLink", (b) => Number(b.chat_id) === GROUP.id && b.creates_join_request === true).length === 1);
  r = await api("GET", "/me", USERS.delegate);
  eq("me: group link offered to registered members", r.json?.group_link, "https://t.me/+esa-test-link");
  await update(textMessage(USERS.delegate, "/start vote"));
  check("start vote: opens the ballots in private chat", /no resolutions open|Voting is <b>OPEN<\/b>/.test(lastTextTo(2005)), lastTextTo(2005));
  await update(textMessage(USERS.delegate, "/start status"));
  check("start status: shows the status in private chat", /Registered as:/.test(lastTextTo(2005)), lastTextTo(2005));
  await update(textMessage(USERS.delegate, "/register"));
  check("register (private, already registered): says so and offers the group", /already registered/.test(lastTextTo(2005)));
  r = await api("GET", "/me", USERS.delegate);
  eq("invitation(chat): delegate is a member of the council", [r.json?.role, r.json?.member?.full_name, r.json?.member?.region], ["member", "Hana Girma", "Addis Ababa Regional Council"]);
  await update(textMessage(USERS.delegate2, "/start inv_" + inv[0].token_id));
  check("invitation(chat): used invitation refused for another account", /already registered/.test(lastTextTo(2006)), lastTextTo(2006));
  await update(textMessage(USERS.delegate2, "/start inv_AARC-NOPE1"));
  check("invitation(chat): unknown code falls back to the normal prompt", /Voting Token ID/.test(lastTextTo(2006)), lastTextTo(2006));
  // App registration with the code from the QR link (?inv= is client-side; the API call is the same)
  // Scanned the QR (bot recognised the code) → the app fills the code in and asks for the password only.
  r = await api("GET", "/register/pending", USERS.delegate2);
  eq("invitation(app): nothing pending before scanning", r.json?.token_id, null);
  await update(textMessage(USERS.delegate2, "/start inv_" + inv[2].token_id));
  check("invitation(chat): the reply tells the member the code is filled in", /already filled in/.test(lastTextTo(2006)), lastTextTo(2006));
  r = await api("GET", "/register/pending", USERS.delegate2);
  eq("invitation(app): the scanned code is offered to the app", [r.json?.token_id, r.json?.full_name], [inv[2].token_id, "Yonas Bekele"]);
  r = await api("POST", "/register", USERS.delegate2, { password: "wrong" });
  eq("invitation(app): wrong password with the remembered code", r.json?.status, "wrong_password");
  r = await api("POST", "/register", USERS.delegate2, { password: inv[2].password });
  eq("invitation(app): second delegate registers with the password alone", [r.json?.status, r.json?.member?.full_name], ["ok", "Yonas Bekele"]);
  check("invitation(app): app registration answers with the group link and sends the completion message", r.json?.group_link === "https://t.me/+esa-test-link" && sentTo(2006).some((c) => /Registration complete/.test(c.body.text) && JSON.stringify(c.body.reply_markup || {}).includes("esa-test-link")), JSON.stringify(sentTo(2006).map((c) => c.body.text.slice(0, 40))));
  r = await api("GET", "/register/pending", USERS.delegate2);
  check("invitation(app): pending code cleared after registration", r.json?.token_id === null && r.json?.registered === true, JSON.stringify(r.json));
  r = await api("POST", "/register", USERS.guest, { password: "x" });
  eq("invitation(app): password alone without a scanned code is refused", r.status, 400);
  r = await api("GET", "/councils", USERS.admin);
  eq("councils: registered count updated", r.json?.items?.find((c) => c.code === "AARC")?.registered, 2);
  // Reissue: only the unregistered seat gets a new password; registered ones keep theirs
  const hashBefore = Object.fromEntries((await rows("members")).filter((m) => m.council_id === AARC.id).map((m) => [m.token_id, m.password_hash]));
  r = await api("POST", "/councils/" + AARC.id + "/reissue", USERS.admin);
  const hashAfter = Object.fromEntries((await rows("members")).filter((m) => m.council_id === AARC.id).map((m) => [m.token_id, m.password_hash]));
  eq("invitations: reissue returns only the unregistered seat", r.json?.rows?.map((x) => x.token_id), [inv[1].token_id]);
  check("invitations: reissue changes only that password", hashAfter[inv[1].token_id] !== hashBefore[inv[1].token_id] && hashAfter[inv[0].token_id] === hashBefore[inv[0].token_id] && hashAfter[inv[2].token_id] === hashBefore[inv[2].token_id]);
  r = await api("POST", "/register", USERS.guest, { token: inv[1].token_id, password: inv[1].password });
  eq("invitations: old password no longer works after reissue", r.json?.status, "wrong_password");
  r = await api("PATCH", "/councils/" + AARC.id, USERS.admin, { name: "Addis Ababa Council", seats: 4 });
  eq("councils: rename + seats", [r.json?.council?.name, r.json?.council?.seats], ["Addis Ababa Council", 4]);
  check("councils: rename updates the delegates' region", (await rows("members")).filter((m) => m.council_id === AARC.id).every((m) => m.region === "Addis Ababa Council"));
  r = await api("GET", "/councils", USERS.guest);
  eq("councils: members cannot access", r.status, 403);
  // Weighted delegate registers; weight visible to the member
  r = await api("POST", "/register", USERS.delegate3, { token: oroInv[0].token_id, password: oroInv[0].password });
  eq("weights: Oromia delegate registers with 2 votes", [r.json?.status, r.json?.member?.vote_weight], ["ok", 2]);
  r = await api("PATCH", "/councils/" + ORO.id, USERS.admin, { vote_weight: 3 });
  eq("weights: council weight edited", r.json?.council?.vote_weight, 3);
  r = await api("GET", "/me", USERS.delegate3);
  eq("weights: delegate weight follows the council", r.json?.member?.vote_weight, 3);
  r = await api("PATCH", "/councils/" + ORO.id, USERS.admin, { vote_weight: 2 });

  // ---- 4. Member registration ------------------------------------------------
  r = await api("POST", "/register", USERS.abebe, { token: creds[0].token_id.toLowerCase(), password: creds[0].password });
  eq("login(app): correct credentials register (case-insensitive token)", r.json?.status, "ok");
  r = await api("GET", "/me", USERS.abebe);
  eq("login(app): user is now a member", [r.json?.role, r.json?.member?.full_name], ["member", "Abebe Kebede"]);
  r = await api("POST", "/register", USERS.dawit, { token: creds[0].token_id, password: creds[0].password });
  eq("login(app): token already bound to another account → conflict", r.json?.status, "conflict");
  r = await api("POST", "/register", USERS.sara, { token: "ESA-2026-NOPE1", password: "x" });
  eq("login(app): unknown token", r.json?.status, "unknown_token");
  let statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await api("POST", "/register", USERS.sara, { token: creds[1].token_id, password: "wrong" + i })).json?.status);
  eq("login(app): 4× wrong then lock on 5th", statuses, ["wrong_password", "wrong_password", "wrong_password", "wrong_password", "locked_now"]);
  r = await api("POST", "/register", USERS.sara, { token: creds[1].token_id, password: creds[1].password });
  eq("login(app): locked token rejects even the right password", r.json?.status, "locked");
  const saraRow = (await rows("members")).find((m) => m.token_id === creds[1].token_id);
  r = await api("GET", "/members?filter=locked", USERS.admin);
  eq("members: locked filter shows the locked token", r.json?.items?.map((m) => m.token_id), [creds[1].token_id]);
  r = await api("POST", "/members/" + saraRow.id + "/unlock", USERS.admin);
  eq("members: admin unlock", r.status, 200);
  r = await api("POST", "/register", USERS.sara, { token: creds[1].token_id, password: creds[1].password });
  eq("login(app): registers after unlock", r.json?.status, "ok");

  // Chat-based login for Dawit (token → password), password message deleted
  await update(textMessage(USERS.dawit, "/start"));
  check("login(chat): /start asks for the token", /Voting Token ID/.test(lastTextTo(2003)), lastTextTo(2003));
  await update(textMessage(USERS.dawit, creds[2].token_id));
  check("login(chat): token accepted, asks for password", /password/i.test(lastTextTo(2003)), lastTextTo(2003));
  const delBefore = calls("deleteMessage").length;
  await update(textMessage(USERS.dawit, creds[2].password));
  check("login(chat): password message deleted", calls("deleteMessage").length === delBefore + 1);
  check("login(chat): registration completed", /Registration complete/.test(sentTo(2003).map((c) => c.body.text).join("\n")));
  r = await api("GET", "/me", USERS.dawit);
  eq("login(chat): same account is a member in the app", r.json?.member?.full_name, "Dawit Alemu");
  r = await api("GET", "/members?filter=registered", USERS.admin);
  eq("members: 6 registered (3 credentials + 3 delegates)", r.json?.total, 6);
  r = await api("GET", "/members?q=sara", USERS.admin);
  eq("members: search by name", r.json?.items?.map((m) => m.full_name), ["Sara Tesfaye"]);

  // ---- 5. Resolutions in different rooms ------------------------------------
  r = await api("POST", "/resolutions", USERS.admin, { title: "Adopt the 2026 annual plan", description: "As circulated.", options: ["Yes", "No", "Abstain"], anonymous: true, activation_required: false });
  eq("resolution: R1 created as secret draft", [r.json?.code, r.json?.status, r.json?.anonymous], ["R1", "draft", true]);
  const R1 = r.json;
  r = await api("POST", "/resolutions", USERS.admin, { title: "Host city for JOTA-JOTI 2026 (typo)", description: null, options: ["Addis Ababa", "Hawassa", "Bahir Dar"], anonymous: false, quorum: 10, threshold: "two_thirds", activation_required: false });
  const R2 = r.json;
  eq("resolution: R2 open ballot with quorum 10% + 2/3", [R2?.code, R2?.anonymous, R2?.quorum, R2?.threshold], ["R2", false, 10, "two_thirds"]);
  r = await api("POST", "/resolutions", USERS.admin, { title: "Bad quorum", options: ["A", "B"], quorum: 120 });
  eq("resolution: quorum above 100% rejected", r.status, 400);
  r = await api("PATCH", "/resolutions/" + R2.id, USERS.admin, { title: "Host city for JOTA-JOTI 2026", options: ["Addis Ababa", "Hawassa", "Bahir Dar"], anonymous: false, quorum: 10, threshold: "two_thirds", activation_required: false });
  eq("resolution: draft edited", r.json?.title, "Host city for JOTA-JOTI 2026");
  r = await api("POST", "/resolutions", USERS.admin, { title: "x", options: ["only one"] });
  eq("resolution: validation rejects bad input", r.status, 400);
  r = await api("POST", "/resolutions/" + R1.id + "/announce", USERS.admin, { chat_id: GROUP.id, thread_id: 11 });
  eq("resolution: cannot announce a draft", r.status, 409);
  r = await api("POST", "/vote", USERS.abebe, { resolution_id: R1.id, choice_index: 0 });
  eq("vote: draft is not open", r.json?.result, "not_open");

  r = await api("POST", "/resolutions/" + R1.id + "/open", USERS.admin, {});
  eq("resolution: R1 opened without deadline", [r.json?.status, r.json?.closes_at], ["open", null]);
  r = await api("POST", "/resolutions/" + R1.id + "/announce", USERS.admin, { chat_id: GROUP.id, thread_id: 11 });
  eq("announce: R1 posted to Day 1 topic", r.json?.posted_to, "Day 1 — Resolutions");
  const ann1 = sentTo(GROUP.id, 11).filter((c) => /R1/.test(c.body.text));
  check("announce: card has 'Vote in private chat' deep link", ann1.length === 1 && ann1[0].body.reply_markup?.inline_keyboard?.[0]?.[0]?.url === `https://t.me/${BOT.username}?start=vote_${R1.id}`, JSON.stringify(ann1[0]?.body.reply_markup));

  r = await api("POST", "/resolutions/" + R2.id + "/open", USERS.admin, { minutes: 90 });
  check("resolution: R2 opened with 90-minute deadline", r.json?.status === "open" && r.json.closes_at && /EAT$/.test(r.json.closes_at_local), JSON.stringify(r.json));
  r = await api("POST", "/resolutions/" + R2.id + "/announce", USERS.admin, { chat_id: GROUP.id, thread_id: 22 });
  eq("announce: R2 posted to JOTA-JOTI topic", r.json?.posted_to, "JOTA-JOTI");
  check("announce: each resolution in its own room", sentTo(GROUP.id, 11).some((c) => /R1/.test(c.body.text)) && sentTo(GROUP.id, 22).some((c) => /R2/.test(c.body.text)) && !sentTo(GROUP.id, 11).some((c) => /R2/.test(c.body.text)));
  r = await api("POST", "/resolutions/" + R1.id + "/open", USERS.admin, {});
  eq("resolution: cannot open twice", r.status, 409);

  // ---- 6. Voting --------------------------------------------------------------
  r = await api("GET", "/ballots", USERS.abebe);
  eq("ballots: member sees 2 open resolutions", r.json?.open?.length, 2);
  check("ballots: member does not see interim counts", r.json.open.every((e) => e.counts === null));
  r = await api("POST", "/vote", USERS.guest, { resolution_id: R1.id, choice_index: 0 });
  eq("vote: guest rejected", [r.status, r.json?.code], [403, "not_registered"]);
  r = await api("POST", "/vote", USERS.abebe, { resolution_id: R1.id, choice_index: 0 });
  eq("vote(secret): first vote ok", r.json?.result, "ok");
  r = await api("POST", "/vote", USERS.abebe, { resolution_id: R1.id, choice_index: 1 });
  eq("vote(secret): second vote blocked", r.json?.result, "already_voted");
  r = await api("POST", "/vote", USERS.sara, { resolution_id: R1.id, choice_index: 1 });
  eq("vote(secret): Sara votes No", r.json?.result, "ok");
  r = await api("POST", "/vote", USERS.dawit, { resolution_id: R1.id, choice_index: 0 });
  eq("vote(secret): Dawit votes Yes", r.json?.result, "ok");
  r = await api("POST", "/vote", USERS.dawit, { resolution_id: R1.id, choice_index: 7 });
  eq("vote: unknown option rejected", r.status, 400);
  const r1Votes = (await rows("votes")).filter((v) => v.resolution_id === R1.id);
  check("anonymity: secret-ballot votes carry no member id", r1Votes.length === 3 && r1Votes.every((v) => v.member_id === null));
  eq("anonymity: ballots (turnout) still recorded", (await rows("ballots")).filter((b) => b.resolution_id === R1.id).length, 3);

  r = await api("POST", "/vote", USERS.abebe, { resolution_id: R2.id, choice_index: 0 });
  eq("vote(open): first vote ok", r.json?.result, "ok");
  r = await api("POST", "/vote", USERS.abebe, { resolution_id: R2.id, choice_index: 1 });
  eq("vote(open): vote can be changed", r.json?.result, "changed");
  r = await api("GET", "/ballots", USERS.abebe);
  eq("vote(open): my_choice reflects the change", r.json?.open?.find((e) => e.id === R2.id)?.my_choice, 1);
  // Sara votes R2 through the chat buttons (two-step confirm)
  await update(callback(USERS.sara, `v|${R2.id}|1`));
  check("vote(chat): option tap asks for confirmation", calls("editMessageText").some((c) => /Confirm your vote/.test(c.body.text)));
  const ballotsBefore = (await rows("ballots")).length;
  await update(callback(USERS.sara, `vc|${R2.id}|1`));
  check("vote(chat): confirmation records the ballot", (await rows("ballots")).length === ballotsBefore + 1 && calls("answerCallbackQuery").some((c) => /Ballot recorded/.test(c.body.text ?? "")));
  await update(callback(USERS.guest, `vc|${R1.id}|0`));
  check("vote(chat): unregistered user told to register", calls("answerCallbackQuery").some((c) => /register first/i.test(c.body.text ?? "")));

  r = await api("GET", "/resolutions/" + R1.id, USERS.admin);
  eq("results(admin): interim tally R1", [r.json?.counts, r.json?.ballots, r.json?.outcome?.leaders], [[2, 1, 0], 3, ["Yes"]]);
  r = await api("GET", "/results/" + R1.id, USERS.abebe);
  eq("results(member): hidden while open", r.status, 403);

  // ---- 7. Close & publish -----------------------------------------------------
  r = await api("POST", "/resolutions/" + R1.id + "/close", USERS.admin);
  check("close: R1 closed and adopted (2 of 3, simple majority)", r.json?.status === "closed" && r.json.outcome?.adopted === true && r.json.outcome.winner === "Yes", JSON.stringify(r.json?.outcome));
  check("close: final results posted to Day 1 topic", sentTo(GROUP.id, 11).some((c) => /Final/.test(c.body.text) && /ADOPTED: Yes/.test(c.body.text)));
  r = await api("POST", "/vote", USERS.sara, { resolution_id: R1.id, choice_index: 1 });
  eq("vote: closed resolution rejects votes", r.json?.result, "not_open");
  r = await api("POST", "/resolutions/" + R1.id + "/open", USERS.admin, {});
  eq("close: closed resolution cannot reopen", r.status, 409);
  r = await api("GET", "/results/" + R1.id, USERS.sara);
  eq("results(member): visible after close", [r.status, r.json?.counts], [200, [2, 1, 0]]);

  // Auto-close: pretend R2's deadline has passed
  const pastDeadline = new Date(Date.now() - 1000).toISOString();
  if (REAL) await realDb.rawDb.from("resolutions").update({ closes_at: pastDeadline }).eq("id", R2.id);
  else db().tables.resolutions.find((x) => x.id === R2.id).closes_at = pastDeadline;
  r = await fetch(base + "/api/tick");
  eq("tick: unauthenticated rejected", r.status, 401);
  r = await fetch(base + "/api/tick?key=wh-secret-123");
  eq("tick: closes the due resolution", (await r.json()).closed, 1);
  r = await api("GET", "/resolutions/" + R2.id, USERS.admin);
  check("auto-close: R2 adopted Hawassa (2/2 votes ≥ 2/3, quorum 10% met)", r.json?.status === "closed" && r.json.outcome?.adopted && r.json.outcome.winner === "Hawassa" && r.json.outcome.quorumMet, JSON.stringify(r.json?.outcome));
  check("auto-close: eligible member count frozen on the resolution", Number.isInteger(r.json?.eligible_count) && r.json.eligible_count > 0 && r.json.outcome?.eligible === r.json.eligible_count && r.json.outcome.quorumRequired === Math.max(1, Math.ceil(r.json.eligible_count * 10 / 100)), JSON.stringify([r.json?.eligible_count, r.json?.outcome]));
  // ---- Reopen a closed resolution --------------------------------------------
  r = await api("POST", "/resolutions/" + R2.id + "/reopen", USERS.admin, { minutes: 30 });
  check("reopen: R2 is open again with a new deadline, ballots kept, eligible count cleared", r.status === 200 && r.json?.status === "open" && r.json.closes_at && r.json.closed_at === null && r.json.eligible_count === null && r.json.ballots === 2, JSON.stringify([r.status, r.json?.status, r.json?.closed_at, r.json?.eligible_count, r.json?.ballots]));
  check("reopen: members told in the announce topic", sentTo(GROUP.id, 22).some((c) => /reopened/.test(c.body.text)));
  r = await api("POST", "/resolutions/" + R2.id + "/reopen", USERS.admin, {});
  eq("reopen: an open resolution cannot be reopened", r.status, 409);
  r = await api("POST", "/resolutions/" + R2.id + "/open", USERS.admin, {});
  eq("reopen: /open on an open resolution still 409", r.status, 409);
  r = await api("POST", "/resolutions/" + R2.id + "/close", USERS.admin);
  check("reopen: closed again with the eligible count frozen anew", r.json?.status === "closed" && Number.isInteger(r.json.eligible_count) && r.json.outcome?.adopted, JSON.stringify([r.json?.status, r.json?.eligible_count]));
  const { computeOutcome } = await import(pathToFileURL(resolve(root, "dist/verdict.js")).href);
  const qres = { options: ["Yes", "No"], threshold: "simple", quorum: 50 };
  eq("quorum: 50% of 12 members needs 6 ballots", computeOutcome(qres, [4, 1], 5, 12).quorumRequired, 6);
  check("quorum: 5 of 6 required ballots → not met, not adopted", !computeOutcome(qres, [4, 1], 5, 12).quorumMet && !computeOutcome(qres, [4, 1], 5, 12).adopted);
  check("quorum: 6 of 6 required ballots → met and adopted", computeOutcome(qres, [5, 1], 6, 12).quorumMet && computeOutcome(qres, [5, 1], 6, 12).adopted);
  eq("quorum: 1% of 3 members still needs 1 ballot", computeOutcome({ ...qres, quorum: 1 }, [0, 0], 0, 3).quorumRequired, 1);
  eq("quorum: none set → no requirement", computeOutcome({ ...qres, quorum: null }, [1, 0], 1, 0).quorumRequired, null);
  check("auto-close: results posted to JOTA-JOTI topic", sentTo(GROUP.id, 22).some((c) => /Final/.test(c.body.text) && /Hawassa/.test(c.body.text)));
  check("auto-close: admin notified by DM", sentTo(1001).some((c) => /reached its deadline/.test(c.body.text)));
  r = await api("GET", "/ballots", USERS.abebe);
  eq("ballots: member now sees 2 closed, 0 open", [r.json?.open?.length, r.json?.closed?.length], [0, 2]);

  // ---- 8. Notify, broadcast, report, publish ----------------------------------
  r = await api("POST", "/resolutions", USERS.admin, { title: "Approve the audited accounts", options: ["Approve", "Reject", "Abstain"], activation_required: false });
  const R3 = r.json;
  await api("POST", "/resolutions/" + R3.id + "/open", USERS.admin, {});
  r = await api("POST", "/resolutions/" + R3.id + "/notify", USERS.admin, { offset: 0 });
  eq("notify: ballot DM'd to all 6 registered members", [r.json?.sent, r.json?.total, r.json?.next_offset], [6, 6, null]);
  check("notify: DM carries vote buttons + app button", calls("sendMessage", (b) => Number(b.chat_id) === 2002 && /R3/.test(b.text ?? "")).some((c) => c.body.reply_markup?.inline_keyboard?.some((row) => row.some((btn) => btn.web_app?.url?.startsWith("https://esa.test/app/")))));
  r = await api("POST", "/broadcast", USERS.admin, { text: "Voting on R3 is open until 17:00.", offset: 0 });
  eq("broadcast: delivered to 6", [r.json?.sent, r.json?.failed], [6, 0]);
  check("broadcast: message text delivered", sentTo(2001).some((c) => /Voting on R3 is open/.test(c.body.text)));
  r = await api("POST", "/resolutions/" + R3.id + "/publish", USERS.admin, { chat_id: GROUP.id, thread_id: 0 });
  check("publish: interim results posted to General", r.status === 200 && sentTo(GROUP.id, null).some((c) => /Interim/.test(c.body.text) && /R3/.test(c.body.text)));
  r = await api("POST", "/report", USERS.admin, { email: false });
  check("report: CSV + HTML sent to admin chat", r.status === 200 && calls("sendDocument", (b) => Number(b.chat_id) === 1001 && /report/.test(b.filename ?? "")).length === 2, JSON.stringify(r.json));
  r = await api("POST", "/report", USERS.admin, { email: true });
  eq("report: email refused when not configured", r.status, 400);

  // ---- 9. Admin management, members admin, drafts -------------------------------
  r = await api("GET", "/dashboard", USERS.newAdmin);
  eq("admins: unknown user forbidden", r.status, 403);
  r = await api("POST", "/setup/admins", USERS.admin, { telegram_user_id: 3001, name: "Second Admin" });
  eq("admins: added from the app", r.status, 200);
  r = await api("GET", "/me", USERS.newAdmin);
  eq("admins: new admin recognised", r.json?.role, "admin");
  r = await api("DELETE", "/setup/admins/1001", USERS.newAdmin);
  eq("admins: env admin cannot be removed in app", r.status, 409);
  r = await api("DELETE", "/setup/admins/3001", USERS.admin);
  eq("admins: removed", r.status, 200);
  r = await api("GET", "/me", USERS.newAdmin);
  eq("admins: access revoked", r.json?.role, "guest");

  const dawitRow = (await rows("members")).find((m) => m.token_id === creds[2].token_id);
  r = await api("POST", "/members/" + dawitRow.id + "/unbind", USERS.admin);
  eq("members: unbind (lost phone)", r.status, 200);
  r = await api("GET", "/me", USERS.dawit);
  eq("members: unbound user is a guest again", r.json?.role, "guest");
  r = await api("POST", "/register", USERS.dawit, { token: creds[2].token_id, password: creds[2].password });
  eq("members: re-registers with same credentials", r.json?.status, "ok");
  r = await api("POST", "/members/" + dawitRow.id + "/active", USERS.admin, { active: false });
  r = await api("POST", "/vote", USERS.dawit, { resolution_id: R3.id, choice_index: 0 });
  eq("members: deactivated member cannot vote", r.status, 403);
  await api("POST", "/members/" + dawitRow.id + "/active", USERS.admin, { active: true });
  r = await api("POST", "/vote", USERS.dawit, { resolution_id: R3.id, choice_index: 0 });
  eq("members: reactivated member votes", r.json?.result, "ok");

  r = await api("POST", "/resolutions", USERS.admin, { title: "Scratch draft", options: ["A", "B"] });
  const R4 = r.json;
  r = await api("DELETE", "/resolutions/" + R4.id, USERS.admin);
  eq("drafts: deleted", r.status, 200);
  r = await api("DELETE", "/resolutions/" + R3.id, USERS.admin);
  eq("drafts: open resolution cannot be deleted", r.status, 409);
  r = await api("PATCH", "/resolutions/" + R1.id, USERS.admin, { title: "x", options: ["A", "B"] });
  eq("drafts: closed resolution cannot be edited", r.status, 409);

  r = await api("GET", "/dashboard", USERS.admin);
  // Weighted tally: a secret ballot where one delegate carries 2 votes
  r = await api("POST", "/resolutions", USERS.admin, { title: "Weighted test", options: ["Yes", "No"], anonymous: true, activation_required: false });
  const RW = r.json;
  await api("POST", "/resolutions/" + RW.id + "/open", USERS.admin, {});
  r = await api("POST", "/vote", USERS.delegate3, { resolution_id: RW.id, choice_index: 0 });
  eq("weights: 2-vote delegate casts a ballot", r.json?.result, "ok");
  r = await api("POST", "/vote", USERS.delegate, { resolution_id: RW.id, choice_index: 1 });
  eq("weights: 1-vote delegate casts a ballot", r.json?.result, "ok");
  r = await api("POST", "/vote", USERS.delegate3, { resolution_id: RW.id, choice_index: 1 });
  eq("weights: secret ballot still cannot be changed", r.json?.result, "already_voted");
  check("weights: vote rows carry the weight but no member id", (await rows("votes")).filter((v) => v.resolution_id === RW.id).every((v) => v.member_id === null) && (await rows("votes")).filter((v) => v.resolution_id === RW.id).map((v) => v.weight).sort().join() === "1,2");
  r = await api("GET", "/results/" + RW.id, USERS.admin);
  eq("weights: tally sums the weights, ballots count people", [r.json?.counts, r.json?.ballots, r.json?.votes_total], [[2, 1], 2, 3]);
  r = await api("POST", "/resolutions/" + RW.id + "/close", USERS.admin);
  eq("weights: Yes adopted 2 votes to 1", [r.json?.outcome?.adopted, r.json?.outcome?.winner], [true, "Yes"]);
  r = await api("POST", "/resolutions/" + RW.id + "/publish", USERS.admin, {});
  check("weights: posted results show ballots and the weighted total", r.status === 200 && calls("sendMessage", (b) => /Weighted test/.test(b.text ?? "") && /Ballots cast: <b>2<\/b> · Votes counted \(weighted\): <b>3<\/b>/.test(b.text ?? "")).length >= 1, JSON.stringify(calls("sendMessage", (b) => /Weighted test/.test(b.text ?? "")).map((c) => c.body.text)));
  r = await api("GET", "/dashboard", USERS.admin);
  eq("dashboard: summary", [r.json?.summary, r.json?.members.registered], [{ draft: 0, open: 1, closed: 3 }, 6]);

  // ---- Activation code (presence check) -------------------------------------
  r = await api("POST", "/resolutions", USERS.admin, { title: "Adopt the scout uniform policy", options: ["Yes", "No"], anonymous: true });
  const RA = r.json;
  eq("activation: required by default", RA?.activation_required, true);
  r = await api("POST", "/resolutions/" + RA.id + "/open", USERS.admin, {});
  const actCode = r.json?.activation_code;
  check("activation: opening creates a 4-digit code shown to the admin", /^\d{4}$/.test(actCode ?? "") && r.json.activations === 0, JSON.stringify([actCode, r.json?.activations]));
  r = await api("GET", "/ballots", USERS.sara);
  const raMember = r.json?.open?.find((x) => x.id === RA.id);
  check("activation: members see that a code is needed, never the code itself", raMember?.needs_activation === true && !("activation_code" in raMember) && !JSON.stringify(r.json).includes(`"${actCode}"`), JSON.stringify(raMember));
  r = await api("POST", "/vote", USERS.sara, { resolution_id: RA.id, choice_index: 0 });
  check("activation: voting without the code is refused", r.status === 403 && r.json?.code === "activation_required", JSON.stringify([r.status, r.json]));
  const wrongCode = actCode === "0000" ? "1111" : "0000";
  r = await api("POST", "/resolutions/" + RA.id + "/activate", USERS.sara, { code: wrongCode });
  eq("activation: wrong code rejected with attempts left", [r.json?.status, r.json?.attempts_left], ["wrong", 4]);
  r = await api("POST", "/resolutions/" + RA.id + "/activate", USERS.sara, { code: actCode });
  eq("activation: right code accepted", r.json?.status, "ok");
  r = await api("POST", "/vote", USERS.sara, { resolution_id: RA.id, choice_index: 0 });
  eq("activation: activated member can vote", r.json?.result, "ok");
  r = await api("GET", "/ballots", USERS.sara);
  eq("activation: no longer asked after activating", r.json?.open?.find((x) => x.id === RA.id)?.needs_activation, false);
  r = await api("GET", "/resolutions/" + RA.id, USERS.admin);
  eq("activation: the admin page counts who entered the code", [r.json?.activation_code, r.json?.activations], [actCode, 1]);
  // Chat path: tapping an option asks for the code, the code unlocks the ballot.
  await update(callback(USERS.delegate, `v|${RA.id}|1`));
  check("activation(chat): tapping an option asks for the code", /4-digit activation code/.test(lastTextTo(2005)), lastTextTo(2005));
  await update(textMessage(USERS.delegate, wrongCode));
  check("activation(chat): wrong code answered", /not the code/.test(lastTextTo(2005)), lastTextTo(2005));
  await update(textMessage(USERS.delegate, actCode));
  check("activation(chat): right code unlocks the ballot with the vote buttons", /Code accepted/.test(lastTextTo(2005)) && JSON.stringify(sentTo(2005).at(-1).body.reply_markup).includes(`v|${RA.id}|`), lastTextTo(2005));
  await update(callback(USERS.delegate, `vc|${RA.id}|1`));
  r = await api("GET", "/resolutions/" + RA.id, USERS.admin);
  eq("activation(chat): the chat vote is counted", [r.json?.ballots, r.json?.activations], [2, 2]);
  // Brute force: five wrong codes lock the member out of that resolution for a while.
  const lockStatuses = [];
  for (let i = 0; i < 5; i++) lockStatuses.push((await api("POST", "/resolutions/" + RA.id + "/activate", USERS.abebe, { code: wrongCode })).json?.status);
  eq("activation: five wrong codes lock the member", lockStatuses, ["wrong", "wrong", "wrong", "wrong", "locked"]);
  r = await api("POST", "/resolutions/" + RA.id + "/activate", USERS.abebe, { code: actCode });
  eq("activation: even the right code is refused while locked", r.json?.status, "locked");
  // A new code for the meeting.
  r = await api("POST", "/resolutions/" + RA.id + "/activation-code", USERS.admin);
  check("activation: admin can issue a new code, earlier activations stay", /^\d{4}$/.test(r.json?.activation_code ?? "") && r.json.activations === 2, JSON.stringify([r.json?.activation_code, r.json?.activations]));
  r = await api("POST", "/resolutions/" + RA.id + "/activation-code", USERS.sara);
  eq("activation: members cannot issue codes", r.status, 403);
  // Opt-out on a draft.
  r = await api("POST", "/resolutions", USERS.admin, { title: "Procedural: adopt the agenda", options: ["Yes", "No"], activation_required: false });
  const RN = r.json;
  r = await api("POST", "/resolutions/" + RN.id + "/open", USERS.admin, {});
  check("activation: a resolution without the requirement opens without a code", r.json?.activation_code === null && r.json.activation_required === false, JSON.stringify(r.json?.activation_code));
  r = await api("POST", "/vote", USERS.sara, { resolution_id: RN.id, choice_index: 0 });
  eq("activation: and members vote straight away", r.json?.result, "ok");
  await api("POST", "/resolutions/" + RA.id + "/close", USERS.admin);
  await api("POST", "/resolutions/" + RN.id + "/close", USERS.admin);

  // ---- Deadline passes without quorum ---------------------------------------
  const pastDue = async (id) => {
    const past = new Date(Date.now() - 1000).toISOString();
    if (REAL) await realDb.rawDb.from("resolutions").update({ closes_at: past }).eq("id", id);
    else db().tables.resolutions.find((x) => x.id === id).closes_at = past;
  };
  const tick = async () => (await (await fetch(base + "/api/tick?key=wh-secret-123")).json()).closed;
  r = await api("POST", "/resolutions", USERS.admin, { title: "Amend the constitution, article 7", options: ["Yes", "No", "Abstain"], quorum: 100, activation_required: false });
  const RQ = r.json;
  await api("POST", "/resolutions/" + RQ.id + "/open", USERS.admin, { minutes: 5 });
  await api("POST", "/vote", USERS.sara, { resolution_id: RQ.id, choice_index: 2 }); // an abstention counts toward quorum
  await pastDue(RQ.id);
  const adminMsgsBefore = sentTo(1001).length;
  eq("quorum: deadline without quorum does not close the vote", await tick(), 0);
  r = await api("GET", "/resolutions/" + RQ.id, USERS.admin);
  check("quorum: the vote stays open and is marked as waiting", r.json?.status === "open" && r.json.awaiting_quorum_since && r.json.outcome?.quorumMet === false && r.json.ballots === 1, JSON.stringify([r.json?.status, r.json?.awaiting_quorum_since, r.json?.ballots]));
  const waitMsg = sentTo(1001).slice(adminMsgsBefore).find((c) => /without quorum/.test(c.body.text));
  check("quorum: admins asked with extend / close as not valid / close and redo", waitMsg && ["qx|" + RQ.id + "|10", "qx|" + RQ.id + "|custom", "qc|" + RQ.id, "qr|" + RQ.id].every((d) => JSON.stringify(waitMsg.body.reply_markup).includes(d)), JSON.stringify(waitMsg?.body));
  check("quorum: delegates who have not voted are reminded once, the voter is not", sentTo(2005).some((c) => /still open/.test(c.body.text) && JSON.stringify(c.body.reply_markup).includes(`v|${RQ.id}|`)) && !sentTo(USERS.sara.id).some((c) => /still open/.test(c.body.text)));
  await tick();
  eq("quorum: no second alert on the next tick", sentTo(1001).filter((c) => /without quorum/.test(c.body.text) && c.body.text.includes(RQ.code)).length, 1);
  // Extend from the chat: preset button, then a custom number of minutes.
  await update(callback(USERS.admin, `qx|${RQ.id}|10`));
  r = await api("GET", "/resolutions/" + RQ.id, USERS.admin);
  check("quorum: '+10 min' extends the deadline and clears the waiting state", r.json?.awaiting_quorum_since === null && new Date(r.json.closes_at).getTime() > Date.now() + 9 * 60_000, JSON.stringify([r.json?.awaiting_quorum_since, r.json?.closes_at]));
  await update(callback(USERS.admin, `qx|${RQ.id}|custom`));
  check("quorum: 'other minutes' asks how many", /how many minutes/.test(lastTextTo(1001)), lastTextTo(1001));
  await update(textMessage(USERS.admin, "25"));
  r = await api("GET", "/resolutions/" + RQ.id, USERS.admin);
  check("quorum: the admin's number of minutes is applied", /extended by 25 min/.test(lastTextTo(1001)) && new Date(r.json.closes_at).getTime() > Date.now() + 24 * 60_000, lastTextTo(1001));
  await update(callback(USERS.guest, `qx|${RQ.id}|5`));
  r = await api("GET", "/resolutions/" + RQ.id, USERS.admin);
  check("quorum: non-admins cannot extend", new Date(r.json.closes_at).getTime() > Date.now() + 24 * 60_000);
  // Extend from the app, then close and redo.
  r = await api("POST", "/resolutions/" + RQ.id + "/extend", USERS.admin, { minutes: 7 });
  check("quorum: the app extends by any number of minutes", r.status === 200 && Math.abs(new Date(r.json.closes_at).getTime() - (Date.now() + 7 * 60_000)) < 60_000, JSON.stringify([r.status, r.json?.closes_at]));
  r = await api("POST", "/resolutions/" + RQ.id + "/extend", USERS.admin, { minutes: 0 });
  eq("quorum: zero minutes rejected", r.status, 400);
  await pastDue(RQ.id);
  await tick();
  r = await api("POST", "/resolutions/" + RQ.id + "/close", USERS.admin, { redo: true });
  check("quorum: 'close and redo' closes as not valid and creates a fresh draft", r.json?.status === "closed" && r.json.outcome?.quorumMet === false && r.json.redo_draft?.code && r.json.redo_draft.code !== RQ.code, JSON.stringify([r.json?.status, r.json?.redo_draft]));
  const redoId = r.json.redo_draft.id;
  r = await api("GET", "/resolutions/" + redoId, USERS.admin);
  check("quorum: the redo draft has the same wording and rules", r.json?.status === "draft" && r.json.title === RQ.title && JSON.stringify(r.json.options) === JSON.stringify(RQ.options) && r.json.quorum === 100 && r.json.activation_required === false && r.json.ballots === 0, JSON.stringify(r.json));
  await api("DELETE", "/resolutions/" + redoId, USERS.admin);
  // Close as not valid from the chat button.
  r = await api("POST", "/resolutions", USERS.admin, { title: "Second waiting vote", options: ["Yes", "No"], quorum: 100, activation_required: false });
  const RQ2 = r.json;
  await api("POST", "/resolutions/" + RQ2.id + "/open", USERS.admin, { minutes: 5 });
  await pastDue(RQ2.id);
  await tick();
  await update(callback(USERS.admin, `qc|${RQ2.id}`));
  r = await api("GET", "/resolutions/" + RQ2.id, USERS.admin);
  check("quorum: 'close as not valid' from the chat closes it with quorum not met", r.json?.status === "closed" && r.json.outcome?.quorumMet === false && /not valid/.test(lastTextTo(1001)), JSON.stringify([r.json?.status, lastTextTo(1001)]));
  // Quorum reached after the deadline: it closes by itself.
  r = await api("POST", "/resolutions", USERS.admin, { title: "Late quorum vote", options: ["Yes", "No"], quorum: 1, activation_required: false });
  const RQ3 = r.json;
  await api("POST", "/resolutions/" + RQ3.id + "/open", USERS.admin, { minutes: 5 });
  await pastDue(RQ3.id);
  eq("quorum: no ballots yet → waits", await tick(), 0);
  await api("POST", "/vote", USERS.sara, { resolution_id: RQ3.id, choice_index: 0 });
  eq("quorum: reached after the deadline → closes on the next tick", await tick(), 1);
  r = await api("GET", "/resolutions/" + RQ3.id, USERS.admin);
  check("quorum: closed and valid, admins told it reached quorum", r.json?.status === "closed" && r.json.outcome?.quorumMet === true && r.json.awaiting_quorum_since === null, JSON.stringify([r.json?.status, r.json?.outcome?.quorumMet]));

  // ---- Group gate: people in the group who are not registered --------------
  const memberUpd = (u, oldStatus, newStatus, by = USERS.admin) => ({ chat_member: { chat: GROUP, from: from(by), date: 20, old_chat_member: { status: oldStatus, user: from(u) }, new_chat_member: { status: newStatus, user: { ...from(u), username: u.username } } } });
  const stranger = { id: 3001, first_name: "Stranger", username: "str4nger" };
  await update(memberUpd(stranger, "left", "member"));
  check("gate: admins told about an unregistered person added to the group", /not registered/.test(lastTextTo(1001)) && /Stranger/.test(lastTextTo(1001)) && /added by/.test(lastTextTo(1001)), lastTextTo(1001));
  check("gate: no removal in the default mode", calls("banChatMember").length === 0);
  r = await api("GET", "/setup", USERS.admin);
  check("gate: Setup lists the unregistered person", r.json?.people?.unregistered?.some((p) => p.user_id === 3001 && p.status === "member" && p.source === "added" && p.name === "Stranger"), JSON.stringify(r.json?.people));
  await update(memberUpd(USERS.abebe, "left", "member", USERS.abebe));
  r = await api("GET", "/setup", USERS.admin);
  check("gate: a registered member joining is not flagged", !(r.json?.people?.unregistered ?? []).some((p) => p.user_id === USERS.abebe.id) && r.json?.people?.registered >= 1, JSON.stringify(r.json?.people));
  r = await api("POST", "/setup/group/people/3001/register", USERS.admin, { name: "Stranger Danger", role: "delegate" });
  check("gate: registered and bound from Setup", r.status === 200 && r.json?.ok === true && r.json.member?.telegram_user_id === 3001 && /^ESA-2026-/.test(r.json.member.token_id), JSON.stringify(r.json));
  check("gate: the new member is welcomed by DM", /registered you as/.test(lastTextTo(3001)) && /Stranger Danger/.test(lastTextTo(3001)), lastTextTo(3001));
  r = await api("GET", "/members?q=Stranger", USERS.admin);
  check("gate: appears in the member list as registered", (r.json?.items ?? []).some((m) => m.telegram_user_id === 3001 && m.full_name === "Stranger Danger"), JSON.stringify(r.json?.items?.length));
  r = await api("POST", "/setup/group/people/3001/register", USERS.admin, { name: "Again" });
  eq("gate: registering twice is refused", r.status, 409);
  r = await api("GET", "/setup", USERS.admin);
  check("gate: no longer listed as unregistered", !(r.json?.people?.unregistered ?? []).some((p) => p.user_id === 3001));
  // Join request from someone unregistered: pending, person told to register, admins asked.
  const joiner = { id: 3002, first_name: "Joiner" };
  await update({ chat_join_request: { chat: GROUP, from: from(joiner), user_chat_id: 3002, date: 21 } });
  check("gate: unregistered join request stays pending and the person is told to register", /Register first/.test(lastTextTo(3002)) && calls("approveChatJoinRequest").length === 0, lastTextTo(3002));
  check("gate: admins asked about the join request", /asks to join/.test(lastTextTo(1001)), lastTextTo(1001));
  r = await api("GET", "/setup", USERS.admin);
  check("gate: pending request listed", r.json?.people?.unregistered?.some((p) => p.user_id === 3002 && p.status === "pending"), JSON.stringify(r.json?.people?.unregistered));
  r = await api("POST", "/setup/group/people/3002/approve", USERS.admin);
  check("gate: approved from Setup", r.json?.ok === true && calls("approveChatJoinRequest", (b) => Number(b.user_id) === 3002).length === 1, JSON.stringify(r.json));
  // Join request from a registered member: approved at once.
  await update({ chat_join_request: { chat: GROUP, from: from(USERS.sara), user_chat_id: USERS.sara.id, date: 22 } });
  check("gate: registered member's join request approved automatically", calls("approveChatJoinRequest", (b) => Number(b.user_id) === USERS.sara.id).length === 1);
  // Registering after a pending request lets the person in.
  const late = { id: 3004, first_name: "Late" };
  await update({ chat_join_request: { chat: GROUP, from: from(late), user_chat_id: 3004, date: 23 } });
  r = await api("POST", "/setup/group/people/3004/register", USERS.admin, { name: "Late Comer", role: "admin" });
  check("gate: registering a pending person approves their request and can make them admin", r.json?.ok === true && r.json.member.role === "admin" && calls("approveChatJoinRequest", (b) => Number(b.user_id) === 3004).length === 1, JSON.stringify(r.json));
  r = await api("GET", "/setup", USERS.admin);
  check("gate: the new admin is listed among admins", (r.json?.admins?.db ?? []).some((a) => Number(a.telegram_user_id) === 3004), JSON.stringify(r.json?.admins));
  // Strict mode: unregistered joiners are removed at once.
  r = await api("POST", "/setup/group/gate", USERS.admin, { mode: "remove" });
  eq("gate: strict mode set", r.json?.mode, "remove");
  const intruder = { id: 3003, first_name: "Intruder" };
  await update(memberUpd(intruder, "left", "member", intruder));
  check("gate: strict mode removes an unregistered joiner (ban + unban)", calls("banChatMember", (b) => Number(b.user_id) === 3003).length === 1 && calls("unbanChatMember", (b) => Number(b.user_id) === 3003).length === 1, JSON.stringify(calls("banChatMember").map((c) => c.body)));
  check("gate: removed person told to register first", /removed from/.test(lastTextTo(3003)), lastTextTo(3003));
  check("gate: admins told about the automatic removal", /removed automatically/.test(lastTextTo(1001)), lastTextTo(1001));
  r = await api("GET", "/setup", USERS.admin);
  check("gate: removed person no longer counted as inside", !(r.json?.people?.unregistered ?? []).some((p) => p.user_id === 3003) && r.json?.people?.gate_mode === "remove");
  r = await api("POST", "/setup/group/gate", USERS.admin, { mode: "flag" });
  eq("gate: back to flag mode", r.json?.mode, "flag");
  r = await api("POST", "/setup/group/people/3002/remove", USERS.admin);
  check("gate: remove from Setup", r.json?.ok === true && calls("banChatMember", (b) => Number(b.user_id) === 3002).length === 1);

  // ---- Revoking invitations and access ----------------------------------------
  r = await api("POST", "/councils", USERS.admin, { name: "Revoke Test Council", seats: 2 });
  const RTC = r.json.council;
  r = await api("POST", "/councils/" + RTC.id + "/invitations", USERS.admin, { count: 1 });
  const revInv = r.json.rows[0];
  r = await api("GET", "/councils/" + RTC.id, USERS.admin);
  const revRow = r.json.invitations[0];
  r = await api("DELETE", "/members/" + revRow.id, USERS.admin);
  eq("revoke: an unused invitation can be revoked", r.json?.ok, true);
  r = await api("GET", "/councils/" + RTC.id, USERS.admin);
  eq("revoke: it is gone from the council", r.json?.invitations?.length, 0);
  r = await api("POST", "/register", USERS.guest, { token: revInv.token_id, password: revInv.password });
  eq("revoke: the revoked code no longer registers", r.json?.status, "unknown_token");
  r = await api("GET", "/members?q=Stranger", USERS.admin);
  const strangerRow = r.json.items.find((m) => m.telegram_user_id === 3001);
  r = await api("DELETE", "/members/" + strangerRow.id, USERS.admin);
  check("revoke: a registered member is never deleted outright", r.status === 409 && r.json?.code === "registered", JSON.stringify([r.status, r.json]));
  const bansBefore = calls("banChatMember", (b) => Number(b.user_id) === 3001).length;
  r = await api("POST", "/members/" + strangerRow.id + "/revoke", USERS.admin);
  check("revoke: access revoked — removed from the group and told", r.json?.ok === true && r.json.removed_from_group === true && calls("banChatMember", (b) => Number(b.user_id) === 3001).length === bansBefore + 1 && /revoked/.test(lastTextTo(3001)), JSON.stringify([r.json, lastTextTo(3001)]));
  r = await api("GET", "/members?q=Stranger", USERS.admin);
  const revoked = r.json.items.find((m) => m.id === strangerRow.id);
  check("revoke: member deactivated and Telegram account detached", revoked && revoked.is_active === false && revoked.telegram_user_id === null, JSON.stringify(revoked));
  r = await api("GET", "/me", { id: 3001, first_name: "Stranger" });
  eq("revoke: the person is a guest again", r.json?.role, "guest");

  // ---- Delegates by phone number ---------------------------------------------
  r = await api("POST", "/councils/" + RTC.id + "/invitations", USERS.admin, { people: [{ name: "Kebede Alemu", phone: "0911 23 45 67" }, { phone: "+251-922-345-678" }, { name: "", phone: "911555666" }] });
  check("phones: invitations issued by name + phone or phone only, numbers normalised", r.status === 200 && JSON.stringify(r.json.rows.map((x) => [x.full_name, x.phone])) === JSON.stringify([["Kebede Alemu", "+251911234567"], [null, "+251922345678"], [null, "+251911555666"]]), JSON.stringify([r.status, r.json?.rows?.map((x) => [x.full_name, x.phone])]));
  const phoneRows = r.json.rows;
  r = await api("POST", "/councils/" + RTC.id + "/invitations", USERS.admin, { people: [{ name: "Bad", phone: "12ab" }] });
  check("phones: something that is not a phone number is refused with its line", r.status === 400 && /Line 1/.test(r.json?.error ?? ""), JSON.stringify(r.json));
  r = await api("GET", "/councils/" + RTC.id, USERS.admin);
  check("phones: the council page shows the phone numbers", r.json?.invitations?.filter((m) => m.phone).length === 3, JSON.stringify(r.json?.invitations?.map((m) => m.phone)));
  r = await api("GET", "/members?q=" + encodeURIComponent("0922345678"), USERS.admin);
  check("phones: Members search finds a delegate by a locally typed number", r.json?.items?.length === 1 && r.json.items[0].phone === "+251922345678", JSON.stringify(r.json?.items));
  r = await api("POST", "/councils/" + RTC.id + "/invitations-pdf", USERS.admin, { rows: phoneRows, separate: true });
  check("phones: one-per-delegate PDFs are named after the phone when there is no name", r.json?.files?.some((f) => /251922345678/.test(f)) && r.json.files.some((f) => /Kebede-Alemu/.test(f)), JSON.stringify(r.json?.files));

  // ---- Bot removed from the group ----------------------------------------
  const botStatus = (oldStatus, newStatus, date) => ({ my_chat_member: { chat: GROUP, from: from(USERS.admin), date, old_chat_member: { status: oldStatus, user: BOT }, new_chat_member: { status: newStatus, user: BOT } } });
  await update(botStatus("administrator", "left", 2));
  r = await api("GET", "/setup", USERS.admin);
  check("group: removing the bot unlinks the group and clears its topics", r.json?.group === null && (r.json?.topics ?? []).length === 0, JSON.stringify([r.json?.group, r.json?.topics?.length]));
  await update(botStatus("left", "administrator", 3));
  r = await api("GET", "/setup", USERS.admin);
  eq("group: re-adding the bot links the group again", r.json?.group?.chat_id, GROUP.id);
  botMembership = "kicked";
  r = await api("GET", "/setup", USERS.admin);
  check("group: Setup refresh unlinks when Telegram says the bot is gone", r.json?.group === null && r.json?.group_rights === null, JSON.stringify([r.json?.group, r.json?.group_rights]));
  botMembership = "administrator";
  await update(botStatus("kicked", "administrator", 4));
  r = await api("GET", "/setup", USERS.admin);
  eq("group: linked again before the error-path check", r.json?.group?.chat_id, GROUP.id);
  botMembership = "gone";
  r = await api("GET", "/setup", USERS.admin);
  check("group: Setup refresh unlinks when Telegram answers 403 for the removed bot", r.json?.group === null && (r.json?.topics ?? []).length === 0, JSON.stringify([r.json?.group, r.json?.group_rights]));
  botMembership = "administrator";
  await update(botStatus("left", "administrator", 5));
  await update({ message: { message_id: msgId++, date: 1, chat: GROUP, from: from(USERS.admin), message_thread_id: 33, is_topic_message: true, text: "ping" } });
  r = await api("GET", "/setup", USERS.admin);
  check("setup: last update from Telegram is reported", r.json?.last_update?.kind === "message" && r.json?.last_update?.chat_id === GROUP.id && r.json?.last_update?.thread_id === 33, JSON.stringify(r.json?.last_update));
  r = await api("DELETE", "/setup/group", USERS.admin);
  eq("group: admin can unlink by hand", r.status, 200);
  r = await api("GET", "/setup", USERS.admin);
  eq("group: unlinked by hand", r.json?.group, null);

  // ---- Group deleted, then the bot is added to a brand-new group -------------
  // Replays 2026-10-31: the deleted group's trailing updates re-linked it, so the new group got no topics or buttons.
  const chatMemberUpd = (chat, oldStatus, newStatus, date) => ({ my_chat_member: { chat, from: from(USERS.admin), date, old_chat_member: { status: oldStatus, user: BOT }, new_chat_member: { status: newStatus, user: BOT } } });
  await update(botStatus("left", "administrator", 10));
  botMembership = "gone";
  r = await api("GET", "/setup", USERS.admin); // Setup refresh notices the group is gone and unlinks it first
  await update(botStatus("administrator", "kicked", 11)); // the removal event arrives afterwards
  await update({ message: { message_id: msgId++, date: 12, chat: GROUP, from: from(USERS.admin), left_chat_member: BOT } });
  await update({ message: { message_id: msgId++, date: 12, chat: GROUP, from: from(USERS.admin), text: "late message" } });
  check("newgroup: trailing updates from the left group do not link it again", !(await rows("app_settings")).some((s) => s.key === "group"), JSON.stringify((await rows("app_settings")).map((s) => s.key)));
  botMembership = "administrator";
  const NEWG = { id: -1000600, type: "supergroup", title: "ESA Assembly 2027", is_forum: true };
  await update(chatMemberUpd(NEWG, "left", "administrator", 13));
  r = await api("GET", "/setup", USERS.admin);
  check("newgroup: the new group is linked and set up (topics created)", r.json?.group?.chat_id === NEWG.id && calls("createForumTopic", (b) => Number(b.chat_id) === NEWG.id).length === 2, JSON.stringify([r.json?.group, calls("createForumTopic").map((c) => c.body.chat_id)]));
  // A stale link to a group the bot is no longer in is replaced automatically.
  const NEWG2 = { id: -1000700, type: "supergroup", title: "ESA Assembly 2028", is_forum: true };
  botMembership = "gone";
  await update(chatMemberUpd(NEWG2, "left", "administrator", 14));
  botMembership = "administrator";
  r = await api("GET", "/setup", USERS.admin);
  check("newgroup: a stale link (bot no longer in it) is replaced by the new group", r.json?.group?.chat_id === NEWG2.id && calls("createForumTopic", (b) => Number(b.chat_id) === NEWG2.id).length === 2, JSON.stringify(r.json?.group));
  // While the assembly group is alive, a second group is not taken over without asking.
  const OTHER = { id: -1000800, type: "supergroup", title: "Side group", is_forum: true };
  await update(chatMemberUpd(OTHER, "left", "administrator", 15));
  r = await api("GET", "/setup", USERS.admin);
  check("newgroup: a second group while the assembly group is alive → admins asked, nothing changed", r.json?.group?.chat_id === NEWG2.id && JSON.stringify(sentTo(1001).at(-1).body.reply_markup).includes(`gswitch|${OTHER.id}`), lastTextTo(1001));
  await update(callback(USERS.admin, `gswitch|${OTHER.id}`));
  r = await api("GET", "/setup", USERS.admin);
  check("newgroup: 'Use the new group instead' switches and sets it up", r.json?.group?.chat_id === OTHER.id && calls("createForumTopic", (b) => Number(b.chat_id) === OTHER.id).length === 2, JSON.stringify(r.json?.group));
  await api("DELETE", "/setup/group", USERS.admin);

  // ---- Group deleted → start over -------------------------------------------
  await update(botStatus("left", "administrator", 6));
  r = await api("GET", "/setup", USERS.admin);
  check("reset: Setup shows the assembly counts and the ask mode", r.json?.assembly?.councils >= 2 && r.json.assembly.members >= 6 && r.json.assembly.resolutions >= 3 && r.json.reset_mode === "ask", JSON.stringify([r.json?.assembly, r.json?.reset_mode]));
  await update(botStatus("administrator", "left", 7));
  check("reset: removal keeps the data and offers the wipe to admins", /data is kept/.test(lastTextTo(1001)) && /councils/.test(lastTextTo(1001)) && JSON.stringify(sentTo(1001).at(-1).body.reply_markup).includes("reset|ask") && (await rows("members")).length > 0, lastTextTo(1001));
  const editsBefore = calls("editMessageText").length;
  await update(callback(USERS.guest, "reset|ask"));
  check("reset: a non-admin cannot start the wipe", (await rows("members")).length > 0 && calls("editMessageText").length === editsBefore);
  await update(callback(USERS.admin, "reset|ask"));
  check("reset: first tap asks for confirmation", calls("editMessageText", (b) => /cannot be undone/.test(b.text) && JSON.stringify(b.reply_markup).includes("reset|yes")).length === 1, JSON.stringify(calls("editMessageText").map((c) => c.body.text)));
  await update(callback(USERS.admin, "reset|keep"));
  check("reset: cancel keeps everything", (await rows("members")).length > 0 && calls("editMessageText", (b) => /is kept/.test(b.text)).length === 1);
  await update(callback(USERS.admin, "reset|ask"));
  await update(callback(USERS.admin, "reset|yes"));
  const left = await Promise.all(["members", "councils", "resolutions", "ballots", "votes", "chat_topics", "group_people"].map((tb) => rows(tb)));
  check("reset: second tap wipes councils, members, resolutions, ballots, votes, topics and people", left.every((rs) => rs.length === 0), JSON.stringify(left.map((rs) => rs.length)));
  const settingsLeft = (await rows("app_settings")).map((s) => s.key);
  check("reset: group settings gone, preferences and admins kept", !settingsLeft.includes("group") && !settingsLeft.includes("signin_topic") && settingsLeft.includes("group_gate") && (await rows("admins")).length > 0 && (await rows("audit_log")).length > 0, JSON.stringify(settingsLeft));
  check("reset: admins told what was wiped", /Wiped:/.test(calls("editMessageText").at(-1).body.text), calls("editMessageText").at(-1).body.text);
  // Automatic mode: removal wipes at once.
  r = await api("POST", "/setup/reset-mode", USERS.admin, { mode: "auto" });
  eq("reset: automatic mode set", r.json?.mode, "auto");
  await update(botStatus("left", "administrator", 8));
  r = await api("POST", "/councils", USERS.admin, { name: "Fresh Council", seats: 2 });
  eq("reset: a council can be created again with any name", r.status, 200);
  await update(botStatus("administrator", "left", 9));
  check("reset: in automatic mode removal wipes the data and tells the admins", (await rows("councils")).length === 0 && /wiped the assembly data/.test(lastTextTo(1001)), lastTextTo(1001));
  r = await api("POST", "/setup/reset-mode", USERS.admin, { mode: "ask" });
  eq("reset: back to ask mode", r.json?.mode, "ask");
  r = await api("POST", "/setup/reset", USERS.admin);
  check("reset: Setup button works on an empty assembly too", r.json?.ok === true && r.json.wiped.councils === 0, JSON.stringify(r.json));

  // ---- A second organisation on the same bot --------------------------------
  const AEA_ADMIN = { id: 6001, first_name: "Architects Secretary" };
  r = await api("POST", "/orgs", AEA_ADMIN, { name_en: "Nope", short_code: "NO" }, null);
  eq("orgs: an organisation admin-to-be cannot create organisations", r.status, 403);
  r = await api("POST", "/orgs", USERS.admin, { name_en: "Association of Ethiopian Architects", name_am: "የኢትዮጵያ አርክቴክቶች ማኅበር", short_code: "aea", voter_term: "member", group_term: "chapter", admin_telegram_id: AEA_ADMIN.id, admin_name: "Architects Secretary" }, null);
  const AEA = r.json?.org;
  check("orgs: platform admin creates a second organisation with its own admin and terms", r.status === 200 && AEA?.short_code === "AEA" && AEA.terms.voter.en === "member" && AEA.terms.group.en_pl === "chapters" && AEA.branded === "Association of Ethiopian Architects (Kene Voting System)", JSON.stringify(r.json));
  r = await api("GET", "/me", AEA_ADMIN, undefined, null);
  check("orgs: the new organisation's admin lands in it without choosing", r.json?.role === "admin" && r.json.org?.id === AEA.id && r.json.orgs.length === 1 && !r.json.org_required, JSON.stringify([r.json?.role, r.json?.org?.id, r.json?.orgs?.length]));
  r = await api("GET", "/orgs", USERS.admin, undefined, null);
  eq("orgs: platform admins see every organisation", r.json?.items?.length, 2);
  r = await api("GET", "/orgs", AEA_ADMIN, undefined, null);
  eq("orgs: an organisation admin sees only theirs", r.json?.items?.map((o) => o.id), [AEA.id]);
  r = await api("PATCH", "/orgs/" + ORG.id, AEA_ADMIN, { name_en: "Hijacked" }, null);
  eq("orgs: an organisation admin cannot edit another organisation", r.status, 403);
  r = await api("PATCH", "/orgs/" + AEA.id, AEA_ADMIN, { assembly_en: "Annual General Meeting 2026", office_en: "Secretariat" }, null);
  check("orgs: an organisation admin edits their own", r.json?.org?.assembly_en === "Annual General Meeting 2026" && r.json.org.office_en === "Secretariat", JSON.stringify(r.json));
  // Same names in both organisations, no clash.
  r = await api("POST", "/councils", USERS.admin, { name: "Addis Ababa", seats: 2 }, ORG.id);
  const esaCouncil = r.json?.council;
  r = await api("POST", "/councils", AEA_ADMIN, { name: "Addis Ababa", seats: 2 }, null);
  const aeaCouncil = r.json?.council;
  check("orgs: the same council name exists in both organisations", esaCouncil?.id && aeaCouncil?.id && esaCouncil.id !== aeaCouncil.id, JSON.stringify([esaCouncil, aeaCouncil]));
  r = await api("POST", "/resolutions", USERS.admin, { title: "ESA motion", options: ["Yes", "No"], activation_required: false }, ORG.id);
  const esaR = r.json;
  r = await api("POST", "/resolutions", AEA_ADMIN, { title: "AEA motion", options: ["Yes", "No"], activation_required: false }, null);
  const aeaR = r.json;
  check("orgs: each organisation numbers its resolutions from R1", esaR?.code === "R1" && aeaR?.code === "R1", JSON.stringify([esaR?.code, aeaR?.code]));
  // Isolation.
  r = await api("GET", "/resolutions", AEA_ADMIN, undefined, ORG.id); // asks for ESA — not theirs
  check("orgs: asking for another organisation falls back to one's own — no leak", r.json?.items?.length === 1 && r.json.items[0].id === aeaR.id, JSON.stringify(r.json?.items?.map((x) => x.title)));
  r = await api("GET", "/resolutions/" + esaR.id, AEA_ADMIN, undefined, null);
  eq("orgs: another organisation's resolution is not found", r.status, 404);
  r = await api("GET", "/resolutions", USERS.admin, undefined, AEA.id);
  check("orgs: a platform admin opens any organisation", r.json?.items?.length === 1 && r.json.items[0].id === aeaR.id);
  // One person in both organisations, registered with each organisation's code.
  r = await api("POST", "/councils/" + aeaCouncil.id + "/invitations", AEA_ADMIN, { names: ["Sara Tesfaye"] }, null);
  const aeaInv = r.json.rows[0];
  check("orgs: invitation codes use the organisation's council code", /^AA-/.test(aeaInv.token_id) || /^[A-Z]+-/.test(aeaInv.token_id), aeaInv.token_id);
  r = await api("POST", "/councils/" + esaCouncil.id + "/invitations", USERS.admin, { names: ["Sara Tesfaye"] }, ORG.id);
  const esaInv = r.json.rows[0];
  const SARA2 = { id: 7002, first_name: "Sara T" };
  r = await api("POST", "/register", SARA2, { token: aeaInv.token_id, password: aeaInv.password }, null);
  check("orgs: registering with an AEA code joins AEA", r.json?.status === "ok" && r.json.org_id === AEA.id, JSON.stringify(r.json));
  r = await api("POST", "/register", SARA2, { token: esaInv.token_id, password: esaInv.password }, ORG.id);
  check("orgs: the same Telegram account registers in ESA too", r.json?.status === "ok" && r.json.org_id === ORG.id, JSON.stringify(r.json));
  r = await api("GET", "/me", SARA2, undefined, null);
  check("orgs: the person now belongs to both; the last registration is active", r.json?.orgs?.length === 2 && r.json.org?.id === ORG.id && r.json.role === "member", JSON.stringify([r.json?.orgs?.length, r.json?.org?.id]));
  r = await api("GET", "/me", SARA2, undefined, AEA.id);
  check("orgs: the app can switch to the other organisation", r.json?.org?.id === AEA.id && r.json.role === "member" && r.json.member?.token_id === aeaInv.token_id, JSON.stringify(r.json?.org));
  // Voting in each organisation.
  await api("POST", "/resolutions/" + esaR.id + "/open", USERS.admin, {}, ORG.id);
  await api("POST", "/resolutions/" + aeaR.id + "/open", AEA_ADMIN, {}, null);
  r = await api("GET", "/ballots", SARA2, undefined, AEA.id);
  check("orgs: the AEA ballot list shows only AEA's vote", r.json?.open?.length === 1 && r.json.open[0].id === aeaR.id, JSON.stringify(r.json?.open?.map((x) => x.title)));
  r = await api("POST", "/vote", SARA2, { resolution_id: esaR.id, choice_index: 0 }, AEA.id);
  eq("orgs: voting on another organisation's resolution from inside AEA fails", r.status, 404);
  r = await api("POST", "/vote", SARA2, { resolution_id: aeaR.id, choice_index: 0 }, AEA.id);
  eq("orgs: voting in AEA", r.json?.result, "ok");
  // The bot chat: buttons carry their organisation; plain commands follow the chosen one.
  await update(callback(SARA2, `v|${esaR.id}|1`));
  await update(callback(SARA2, `vc|${esaR.id}|1`));
  r = await api("GET", "/resolutions/" + esaR.id, USERS.admin, undefined, ORG.id);
  eq("orgs(chat): a vote button works whatever organisation the chat is on", r.json?.ballots, 1);
  await update(textMessage(SARA2, "/org"));
  check("orgs(chat): /org offers both organisations", JSON.stringify(sentTo(SARA2.id).at(-1).body.reply_markup).includes(`org|${AEA.id}`) && JSON.stringify(sentTo(SARA2.id).at(-1).body.reply_markup).includes(`org|${ORG.id}`));
  await update(callback(SARA2, `org|${AEA.id}`));
  await update(textMessage(SARA2, "/status"));
  check("orgs(chat): after choosing AEA, /status is about AEA", /AEA motion/.test(lastTextTo(SARA2.id)) && !/ESA motion/.test(lastTextTo(SARA2.id)), lastTextTo(SARA2.id));
  // Groups: each organisation links its own.
  const AEA_GROUP = { id: -1000900, type: "supergroup", title: "Architects AGM", is_forum: true };
  await update({ my_chat_member: { chat: AEA_GROUP, from: from(AEA_ADMIN), date: 30, old_chat_member: { status: "left", user: BOT }, new_chat_member: { status: "administrator", user: BOT } } });
  r = await api("GET", "/setup", AEA_ADMIN, undefined, null);
  eq("orgs(group): the group added by AEA's admin becomes AEA's group", r.json?.group?.chat_id, AEA_GROUP.id);
  const aeaCard = sentTo(AEA_GROUP.id).find((c) => /Sign in/.test(c.body.text ?? ""));
  check("brand: AEA's sign-in card speaks AEA's words", aeaCard && /Association of Ethiopian Architects \(Kene Voting System\)/.test(aeaCard.body.text) && /Members register once with the invitation code from the Secretariat/.test(aeaCard.body.text) && /AEA-2026-XXXXX/.test(aeaCard.body.text) && !/ESA|National Office|Delegates/.test(aeaCard.body.text), aeaCard?.body.text);
  const aeaRef = sentTo(AEA_GROUP.id).find((c) => /Commands —/.test(c.body.text ?? ""));
  check("brand: AEA's command reference carries its name in English and Amharic", aeaRef && /Commands — Association of Ethiopian Architects \(Kene Voting System\)/.test(aeaRef.body.text) && /የኢትዮጵያ አርክቴክቶች ማኅበር \(Kene Voting System\)/.test(aeaRef.body.text), aeaRef?.body.text?.slice(0, 200));
  const GUEST2 = { id: 7100, first_name: "Newcomer" };
  await update(textMessage(GUEST2, "/start"));
  check("brand: with several organisations a newcomer is welcomed by the platform", /Welcome to Kene Voting System/.test(lastTextTo(GUEST2.id)) && !/ESA/.test(lastTextTo(GUEST2.id)), lastTextTo(GUEST2.id));
  r = await api("POST", "/councils/" + aeaCouncil.id + "/invitations-pdf", AEA_ADMIN, { rows: [aeaInv], separate: true }, null);
  check("brand: AEA's per-member PDF is named after AEA", r.json?.files?.[0]?.startsWith("aea-invitation-"), JSON.stringify(r.json?.files));
  const OTHER_GROUP = { id: -1000950, type: "supergroup", title: "Mystery group", is_forum: true };
  await update({ my_chat_member: { chat: OTHER_GROUP, from: from(USERS.admin), date: 31, old_chat_member: { status: "left", user: BOT }, new_chat_member: { status: "administrator", user: BOT } } });
  const ask = sentTo(1001).at(-1);
  check("orgs(group): a platform admin adding the bot is asked which organisation", /Which organisation is this group for/.test(ask.body.text) && JSON.stringify(ask.body.reply_markup).includes(`gswitch|${OTHER_GROUP.id}|${ORG.id}`) && JSON.stringify(ask.body.reply_markup).includes(`gswitch|${OTHER_GROUP.id}|${AEA.id}`), JSON.stringify(ask.body));
  await update(callback(USERS.admin, `gswitch|${OTHER_GROUP.id}|${ORG.id}`));
  r = await api("GET", "/setup", USERS.admin, undefined, ORG.id);
  eq("orgs(group): choosing ESA links the group to ESA", r.json?.group?.chat_id, OTHER_GROUP.id);
  r = await api("GET", "/setup", AEA_ADMIN, undefined, null);
  eq("orgs(group): AEA keeps its own group", r.json?.group?.chat_id, AEA_GROUP.id);
  await update({ message: { message_id: msgId++, date: 32, chat: AEA_GROUP, from: from(AEA_ADMIN), message_thread_id: 77, is_topic_message: true, forum_topic_created: { name: "Design review", icon_color: 0 } } });
  r = await api("GET", "/setup", AEA_ADMIN, undefined, null);
  const esaTopics = (await api("GET", "/setup", USERS.admin, undefined, ORG.id)).json?.topics ?? [];
  check("orgs(group): topics learned in AEA's group stay in AEA", (r.json?.topics ?? []).some((t) => t.thread_id === 77) && !esaTopics.some((t) => t.thread_id === 77), JSON.stringify([r.json?.topics?.map((t) => t.thread_id), esaTopics.map((t) => t.thread_id)]));
  // Deadlines of every organisation are handled.
  await pastDue(esaR.id);
  await pastDue(aeaR.id);
  eq("orgs: the scheduler closes due votes in every organisation", await tick(), 2);
  r = await api("GET", "/resolutions/" + aeaR.id, AEA_ADMIN, undefined, null);
  eq("orgs: AEA's vote closed with its own ballots", [r.json?.status, r.json?.ballots], ["closed", 1]);
  // Settings and admins are per organisation.
  r = await api("POST", "/setup/group/gate", AEA_ADMIN, { mode: "remove" }, null);
  r = await api("GET", "/setup", USERS.admin, undefined, ORG.id);
  eq("orgs: AEA's gate setting does not touch ESA's", r.json?.people?.gate_mode ?? "flag", "flag");
  r = await api("GET", "/members", AEA_ADMIN, undefined, null);
  check("orgs: AEA's member list holds only AEA's invitation", r.json?.items?.length === 1 && r.json.items[0].token_id === aeaInv.token_id, JSON.stringify(r.json?.items?.map((m) => m.token_id)));
  r = await api("GET", "/audit?limit=200", AEA_ADMIN, undefined, null);
  check("orgs: AEA's audit log holds only AEA's actions", (r.json?.items ?? []).length > 0 && !(r.json?.items ?? []).some((a) => /ESA motion/.test(JSON.stringify(a.details))), JSON.stringify(r.json?.items?.length));
  // ---- An organisation without councils: members vote for themselves (e.g. a share company) ----
  r = await api("POST", "/orgs", USERS.admin, { name_en: "Kene Share Company", short_code: "KSC", structure: "direct", voter_term: "member" }, null);
  const KSC = r.json?.org;
  check("direct: an organisation can have no councils", r.status === 200 && KSC?.structure === "direct", JSON.stringify(r.json));
  r = await api("POST", "/members/invitations", USERS.admin, { people: [{ name: "Shareholder A", phone: "0911000001", votes: 250 }, { name: "Shareholder B", votes: 120 }, { phone: "+251911000003" }] }, KSC.id);
  const kscRows = r.json?.rows ?? [];
  check("direct: members added directly with their own votes, codes start with the organisation's code", r.status === 200 && kscRows.length === 3 && kscRows.every((x) => /^KSC-\d{4}-/.test(x.token_id)) && JSON.stringify(kscRows.map((x) => x.vote_weight)) === "[250,120,1]", JSON.stringify(kscRows.map((x) => [x.token_id, x.vote_weight])));
  r = await api("POST", "/members/invitations", USERS.admin, { people: [{ name: "Bad", votes: 0 }] }, KSC.id);
  eq("direct: zero votes refused", r.status, 400);
  r = await api("POST", "/members/invitations-pdf", USERS.admin, { rows: kscRows, separate: true }, KSC.id);
  check("direct: one invitation PDF per member, without a council", r.status === 200 && r.json?.files?.length === 3 && r.json.files.every((f) => /^ksc-invitation-ksc-\d{4}-/.test(f)) && r.json.files.some((f) => /Shareholder-A/.test(f)), JSON.stringify(r.json));
  r = await api("POST", "/members/invitations-pdf", USERS.admin, { rows: kscRows }, KSC.id);
  check("direct: one PDF with all members", r.status === 200 && /^ksc-invitations-members-/.test(r.json?.file ?? ""), JSON.stringify(r.json));
  const SH_A = { id: 8001, first_name: "Shareholder A" }, SH_B = { id: 8002, first_name: "Shareholder B" };
  await api("POST", "/register", SH_A, { token: kscRows[0].token_id, password: kscRows[0].password }, null);
  await api("POST", "/register", SH_B, { token: kscRows[1].token_id, password: kscRows[1].password }, null);
  r = await api("GET", "/members", USERS.admin, undefined, KSC.id);
  const shA = r.json?.items?.find((m) => m.token_id === kscRows[0].token_id);
  check("direct: the member list shows each member's votes", shA?.vote_weight === 250, JSON.stringify(shA));
  r = await api("POST", "/resolutions", USERS.admin, { title: "Approve the dividend", options: ["Yes", "No"], activation_required: false }, KSC.id);
  const KR = r.json;
  await api("POST", "/resolutions/" + KR.id + "/open", USERS.admin, {}, KSC.id);
  await api("POST", "/vote", SH_A, { resolution_id: KR.id, choice_index: 0 }, KSC.id);
  await api("POST", "/vote", SH_B, { resolution_id: KR.id, choice_index: 1 }, KSC.id);
  r = await api("GET", "/resolutions/" + KR.id, USERS.admin, undefined, KSC.id);
  check("direct: votes are weighted by shares (250 yes vs 120 no), ballots count people", JSON.stringify(r.json?.counts) === "[250,120]" && r.json.ballots === 2 && r.json.outcome?.winner === "Yes", JSON.stringify([r.json?.counts, r.json?.ballots]));
  r = await api("POST", "/members/" + shA.id + "/votes", USERS.admin, { votes: 300 }, KSC.id);
  eq("direct: an admin changes a member's votes", r.json?.vote_weight, 300);
  r = await api("POST", "/members/" + shA.id + "/votes", AEA_ADMIN, { votes: 1 }, null);
  check("direct: another organisation's admin cannot change them", r.status === 403 || r.status === 404, String(r.status));
  r = await api("GET", "/me", USERS.admin, undefined, ORG.id);
  eq("direct: ESA keeps its councils", r.json?.org?.structure, "councils");
  defaultOrg = ORG.id;

  r = await api("GET", "/audit?limit=200", USERS.admin);
  const actions = new Set((r.json?.items ?? []).map((a) => a.action));
  check("audit: platform actions stay out of the organisation log", (await rows("audit_log")).some((a) => a.action === "webhook_registered" && a.org_id == null) && !actions.has("webhook_registered"));
  check("audit: key actions recorded", ["organization_created", "credentials_generated", "login_success", "login_failed", "resolution_created", "resolution_opened", "resolution_reopened", "resolution_announced", "group_locked", "signin_card_posted", "commands_posted", "invitation_revoked", "member_access_revoked", "deadline_without_quorum", "resolution_extended", "resolution_redo", "vote_activated", "vote_activation_locked", "activation_code_changed", "assembly_reset", "reset_mode_set", "member_registered_by_admin", "group_member_removed", "join_request_approved", "group_gate_set", "vote_cast", "vote_changed", "resolution_closed", "broadcast", "report_generated", "admin_added", "unbind", "council_created", "invitations_issued", "invitations_pdf_sent", "invitations_reissued", "topic_renamed", "group_unlinked"].every((a) => actions.has(a)), [...actions].join());
  const auditJson = JSON.stringify(await rows("audit_log"));
  check("audit: never logs passwords or choices", !auditJson.includes(creds[0].password) && !auditJson.includes('"choice'));

  // Mini App static + landing page (the hosting readiness probe requests "/")
  r = await fetch(base + "/app/");
  check("app: Mini App page served", r.status === 200 && /telegram-web-app\.js/.test(await r.text()));
  for (const f of ["i18n.js", "help.js", "app.css"]) { r = await fetch(base + "/app/" + f); check("app: /app/" + f + " served", r.status === 200 && (await r.text()).length > 1000); }
  r = await fetch(base + "/");
  check("app: landing page answers 200 for the readiness probe", r.status === 200 && /\/app\//.test(await r.text()));
  r = await fetch(base + "/healthz");
  eq("app: /healthz is 200", r.status, 200);
} catch (err) {
  check("harness: no unexpected exception", false, err.stack || String(err));
}

appServer.close();
tgServer.close();
if (REAL) await realDb.rawDb.end();

// ---------------------------------------------------------------- report
let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.info ? "\n      " + r.info : ""}`);
  if (!r.ok) failed++;
}
console.log(`\n${results.length - failed}/${results.length} checks passed; Telegram API calls made: ${tgCalls.length}`);
process.exit(failed ? 1 : 0);
