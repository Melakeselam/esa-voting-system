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
  }
  tgCalls.push({ method, body });
  let result = true;
  switch (method) {
    case "getMe": result = BOT; break;
    case "setWebhook": webhookUrl = body.url; break;
    case "deleteWebhook": webhookUrl = ""; break;
    case "getWebhookInfo": result = { url: webhookUrl, has_custom_certificate: false, pending_update_count: 0 }; break;
    case "sendMessage":
    case "sendDocument":
      result = { message_id: nextMessageId++, date: Math.floor(Date.now() / 1000), chat: { id: Number(body.chat_id), type: Number(body.chat_id) < 0 ? "supergroup" : "private" }, text: body.text ?? "" };
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
const TABLES = ["members", "resolutions", "ballots", "votes", "audit_log", "app_settings", "chat_topics", "admins"];
if (REAL) {
  await realDb.ensureSchema();
  await realDb.supabase.exec(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  console.log(`Running against PostgreSQL: ${process.env.TEST_DATABASE_URL.replace(/\/\/.*@/, "//***@")}`);
}
const db = () => globalThis.__fakeSupabase;
/** Raw rows of a table (fake: in-memory array; real: SELECT *). */
async function rows(table) {
  if (!REAL) return db().tables[table];
  const { data, error } = await realDb.supabase.from(table).select("*");
  if (error) throw error;
  return data;
}
/** Pretend a table is missing (fake: flag; real: rename it away and back). */
async function hideTable(table, hidden) {
  if (!REAL) { hidden ? db().missing.add(table) : db().missing.delete(table); return; }
  await realDb.supabase.exec(hidden ? `ALTER TABLE ${table} RENAME TO ${table}_hidden` : `ALTER TABLE ${table}_hidden RENAME TO ${table}`);
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
};

async function api(method, path, user, body) {
  const res = await fetch(base + "/api/app" + path, {
    method,
    headers: { "content-type": "application/json", ...(user ? { authorization: "tma " + initData(user) } : {}) },
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
  eq("setup: reports app url", setup.app_url, "https://esa.test/app/");

  eq("webhook: wrong secret rejected", await update(textMessage(USERS.guest, "/start"), "nope"), 401);
  eq("webhook: no secret rejected", await (await fetch(base + "/telegram", { method: "POST", body: "{}" })).status, 401);

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

  // ---- 2. Group and topics ("rooms") learned from Telegram ------------------
  await update({ my_chat_member: { chat: GROUP, from: from(USERS.admin), date: 1, old_chat_member: { status: "left", user: BOT }, new_chat_member: { status: "administrator", user: BOT, can_be_edited: false, is_anonymous: false, can_manage_chat: true, can_delete_messages: true, can_manage_video_chats: false, can_restrict_members: false, can_promote_members: false, can_change_info: false, can_invite_users: false, can_post_stories: false, can_edit_stories: false, can_delete_stories: false } } });
  const topicMsg = (threadId, name) => ({ message: { message_id: msgId++, date: 1, chat: GROUP, from: from(USERS.admin), message_thread_id: threadId, is_topic_message: true, forum_topic_created: { name, icon_color: 0 } } });
  await update(topicMsg(11, "Day 1 — Resolutions"));
  await update(topicMsg(22, "JOTA-JOTI"));
  // a plain message in a topic the bot has not seen created (name unknown)
  await update({ message: { message_id: msgId++, date: 1, chat: GROUP, from: from(USERS.admin), message_thread_id: 33, is_topic_message: true, text: "hello" } });
  r = await api("GET", "/setup", USERS.admin);
  eq("rooms: group linked", r.json?.group?.chat_id, GROUP.id);
  const topicNames = Object.fromEntries((r.json?.topics ?? []).map((t) => [t.thread_id, t.name]));
  eq("rooms: General + 3 topics known", Object.keys(topicNames).length, 4);
  eq("rooms: topic names learned", [topicNames[0], topicNames[11], topicNames[22], topicNames[33]], ["General", "Day 1 — Resolutions", "JOTA-JOTI", null]);
  r = await api("PATCH", "/setup/topics/" + GROUP.id + "/33", USERS.admin, { name: "Announcements" });
  eq("rooms: topic renamed from app", r.status, 200);
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
  eq("members: 3 registered", r.json?.total, 3);
  r = await api("GET", "/members?q=sara", USERS.admin);
  eq("members: search by name", r.json?.items?.map((m) => m.full_name), ["Sara Tesfaye"]);

  // ---- 5. Resolutions in different rooms ------------------------------------
  r = await api("POST", "/resolutions", USERS.admin, { title: "Adopt the 2026 annual plan", description: "As circulated.", options: ["Yes", "No", "Abstain"], anonymous: true });
  eq("resolution: R1 created as secret draft", [r.json?.code, r.json?.status, r.json?.anonymous], ["R1", "draft", true]);
  const R1 = r.json;
  r = await api("POST", "/resolutions", USERS.admin, { title: "Host city for JOTA-JOTI 2026 (typo)", description: null, options: ["Addis Ababa", "Hawassa", "Bahir Dar"], anonymous: false, quorum: 2, threshold: "two_thirds" });
  const R2 = r.json;
  eq("resolution: R2 open ballot with quorum + 2/3", [R2?.code, R2?.anonymous, R2?.quorum, R2?.threshold], ["R2", false, 2, "two_thirds"]);
  r = await api("PATCH", "/resolutions/" + R2.id, USERS.admin, { title: "Host city for JOTA-JOTI 2026", options: ["Addis Ababa", "Hawassa", "Bahir Dar"], anonymous: false, quorum: 2, threshold: "two_thirds" });
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
  if (REAL) await realDb.supabase.from("resolutions").update({ closes_at: pastDeadline }).eq("id", R2.id);
  else db().tables.resolutions.find((x) => x.id === R2.id).closes_at = pastDeadline;
  r = await fetch(base + "/api/tick");
  eq("tick: unauthenticated rejected", r.status, 401);
  r = await fetch(base + "/api/tick?key=wh-secret-123");
  eq("tick: closes the due resolution", (await r.json()).closed, 1);
  r = await api("GET", "/resolutions/" + R2.id, USERS.admin);
  check("auto-close: R2 adopted Hawassa (2/2 votes ≥ 2/3, quorum 2 met)", r.json?.status === "closed" && r.json.outcome?.adopted && r.json.outcome.winner === "Hawassa" && r.json.outcome.quorumMet, JSON.stringify(r.json?.outcome));
  check("auto-close: results posted to JOTA-JOTI topic", sentTo(GROUP.id, 22).some((c) => /Final/.test(c.body.text) && /Hawassa/.test(c.body.text)));
  check("auto-close: admin notified by DM", sentTo(1001).some((c) => /reached its deadline/.test(c.body.text)));
  r = await api("GET", "/ballots", USERS.abebe);
  eq("ballots: member now sees 2 closed, 0 open", [r.json?.open?.length, r.json?.closed?.length], [0, 2]);

  // ---- 8. Notify, broadcast, report, publish ----------------------------------
  r = await api("POST", "/resolutions", USERS.admin, { title: "Approve the audited accounts", options: ["Approve", "Reject", "Abstain"] });
  const R3 = r.json;
  await api("POST", "/resolutions/" + R3.id + "/open", USERS.admin, {});
  r = await api("POST", "/resolutions/" + R3.id + "/notify", USERS.admin, { offset: 0 });
  eq("notify: ballot DM'd to all 3 registered members", [r.json?.sent, r.json?.total, r.json?.next_offset], [3, 3, null]);
  check("notify: DM carries vote buttons + app button", calls("sendMessage", (b) => Number(b.chat_id) === 2002 && /R3/.test(b.text ?? "")).some((c) => c.body.reply_markup?.inline_keyboard?.some((row) => row.some((btn) => btn.web_app?.url?.startsWith("https://esa.test/app/")))));
  r = await api("POST", "/broadcast", USERS.admin, { text: "Voting on R3 is open until 17:00.", offset: 0 });
  eq("broadcast: delivered to 3", [r.json?.sent, r.json?.failed], [3, 0]);
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
  eq("dashboard: summary", [r.json?.summary, r.json?.members.registered], [{ draft: 0, open: 1, closed: 2 }, 3]);
  r = await api("GET", "/audit?limit=200", USERS.admin);
  const actions = new Set((r.json?.items ?? []).map((a) => a.action));
  check("audit: key actions recorded", ["webhook_registered", "credentials_generated", "login_success", "login_failed", "resolution_created", "resolution_opened", "resolution_announced", "vote_cast", "vote_changed", "resolution_closed", "broadcast", "report_generated", "admin_added", "unbind"].every((a) => actions.has(a)), [...actions].join());
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
if (REAL) await realDb.supabase.end();

// ---------------------------------------------------------------- report
let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.info ? "\n      " + r.info : ""}`);
  if (!r.ok) failed++;
}
console.log(`\n${results.length - failed}/${results.length} checks passed; Telegram API calls made: ${tgCalls.length}`);
process.exit(failed ? 1 : 0);
