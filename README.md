# ESA General Assembly — Secure Voting System

A Telegram-bot voting system for the Ethiopia Scout Association's nation-wide
General Assembly. The National Office issues each voting member a **Token ID +
password**; members register once in a private chat with the bot, then vote on
resolutions via inline buttons. Resolutions are announced in the assembly's
Telegram group topics; results are tallied server-side and published back to
the same topic.

## Architecture

```
Members (Telegram DMs)      Assembly supergroup (topics)
        │  vote buttons             │  /announce cards + results
        ▼                           ▼
 ┌──────────────────────────────────────────┐
 │  Bot backend (Node.js + grammY)          │   AletCloud app (Ethiopia)
 │  webhook mode, HTTPS, secret token       │   (long polling locally)
 └──────────────────┬───────────────────────┘
                    │ DATABASE_URL (private network only)
                    ▼
 ┌──────────────────────────────────────────┐
 │  PostgreSQL 16 (AletCloud managed)       │
 │  members · resolutions · ballots ·       │
 │  votes · audit_log                       │
 │  cast_vote() — atomic, double-vote safe  │
 └──────────────────────────────────────────┘
```

Everything is hosted on [AletCloud](https://aletcloud.com), an Ethiopian cloud,
so member data never leaves the country (Personal Data Protection Proclamation
No. 1321/2024). The database has no public endpoint: only the app, inside the
same private network, can reach it.

**Key security properties**

- Passwords stored only as bcrypt hashes; the plaintext exists only in the
  generated distribution CSV (delete after distribution).
- One token ↔ one Telegram account (bound at first login; admin can `/unbind`).
- One ballot per member per resolution, enforced by a DB primary key inside an
  atomic `cast_vote()` function — no race can double-count.
- **Secret ballots** (default): the choice row stores `member_id = NULL`, so
  even the database cannot link a vote to a person. The `ballots` table only
  records *that* someone voted (turnout + double-vote guard).
- **Open ballots** (per-resolution toggle): choice is linked, member may change
  their vote until close.
- 5 failed passwords → token locked 15 minutes. Password messages are deleted
  from the chat immediately after checking.
- The database is reachable only from the hosting platform's private network;
  the connection string lives only in the app's environment.
- Webhook protected by Telegram's `secret_token` header; all traffic HTTPS.
- All sensitive actions written to `audit_log`.

## 1. Prerequisites

- Node.js ≥ 20
- A Telegram account for setup, plus one per tester
- An [AletCloud](https://aletcloud.com) account (the Solo app and database
  plans are free) and a GitHub account for the repository
- For local development: PostgreSQL 14+ (Docker is the easiest way, see
  `SETUP.md` Part 3)

## 2. Create the Telegram bot

1. In Telegram, talk to **@BotFather** → `/newbot` → pick a name (e.g. *ESA
   Assembly Voting*) and a username (e.g. `esa_voting_bot`). Save the token.
2. Create the assembly **supergroup**, enable **Topics** (group settings →
   Topics), and create topics such as *Day 1 — Resolutions*, *JOTA-JOTI*, etc.
3. Add the bot to the group and **make it an admin** (needs to post and delete
   messages in topics).

## 3. Set up the database

The app needs a PostgreSQL connection string in `DATABASE_URL`. It applies
`db/schema.sql` itself at every start-up (every statement is idempotent), so
there is nothing to run by hand — not on first install and not after upgrades.

- **Production:** an AletCloud managed PostgreSQL linked to the app (the
  dashboard fills in `DATABASE_URL`). See `SETUP.md` Part 3 and Part 6.
- **Locally:** any PostgreSQL, e.g.
  `docker run -d --name esa-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=esa_voting -p 5432:5432 postgres:16`
  and `DATABASE_URL=postgres://postgres:postgres@localhost:5432/esa_voting`.

`npm run db:migrate` applies the schema by hand if you ever need to.

## 4. Configure and run locally

```powershell
npm install
copy .env.example .env      # then fill in BOT_TOKEN and DATABASE_URL
npm run dev                 # starts in long-polling mode, no public URL needed
```

Send `/whoami` to your bot — it replies with your Telegram ID. Put it in
`ADMIN_TELEGRAM_IDS` in `.env` and restart. You are now an admin.

## 5. Generate member credentials

```powershell
npm run gen:credentials -- --count 10
# or with names:  npm run gen:credentials -- --names members.csv
#                 (each line: Full Name,Region)
```

This inserts hashed credentials into the database and writes
`out/credentials-<timestamp>.csv` containing the **plaintext** passwords —
the National Office distributes one row to each member (SMS, sealed envelope,
etc.) and then deletes the file. (The Mini App can do the same from
**Members → Credentials**, delivering the CSV to the admin's own chat.)

## 6. Deploy on AletCloud

Full walkthrough in `SETUP.md`, Part 6. In short:

1. Push this folder to a (private) GitHub repository and allow AletCloud to
   read it (dashboard → GitHub integration).
2. In the AletCloud project: create a **PostgreSQL** database (Solo plan,
   free) and a **Node.js app** from the repository (branch `main`, root `.`,
   Solo plan). Link the database to the app — this sets `DATABASE_URL`.
3. Add the environment variables `BOT_TOKEN`, `ADMIN_TELEGRAM_IDS`,
   `WEBHOOK_SECRET` (40+ random characters) and
   `PUBLIC_URL=https://<app>.app.aletcloud.com`, then restart/redeploy.
4. On boot the app applies the schema, switches to webhook mode and registers
   its webhook, commands and menu button itself. The logs show
   `Webhook set to … — @your_bot is live.`

Until the variables are set the app serves a "not configured" page (and stays
healthy from the platform's point of view) instead of crash-looping.
Pushing to `main` rebuilds and redeploys automatically; all voting data lives
in the database, so deploys are safe mid-assembly.

> Only one instance may talk to Telegram at a time. Stop `npm run dev` locally
> before the deployment goes live (webhook mode takes over from polling).

## 6b. The Mini App

**Councils and printed invitations.** When voting members are chosen by
councils (regions, sections), use **Members → ＋ Invitations** instead of plain
credentials. Each council gets a name and a number of voting seats; the admin
types the delegate names (or leaves them anonymous) or imports an Excel/CSV
sheet with the columns `Council, Name, Seats`. Every invitation is a member
row whose token starts with the council code (`AARC-K7M2P`), and the bot
sends the admin one **PDF per council**: two A4 cards per page with council,
delegate, invitation code, password, a **QR code** and a deep link
(`https://t.me/<bot>?start=inv_<code>`). Scanning the code opens the bot,
which recognises the invitation and only asks for the password. The
recognised code is remembered for that Telegram account (72 h, `app_settings`
key `pending_inv:<id>`), so the Mini App fills it in whichever way it is
opened — inline button or menu button — and asks for the password only. Lost sheet: "New passwords for unregistered
delegates" reissues the PDF without touching registered members. The PDF
**Vote weight:** each council also sets the votes per delegate (default 1), so
6 delegates × 1 vote and 3 delegates × 2 votes both carry 6 votes. The weight
is stamped on each vote when cast (secret ballots keep no member id), the SQL
tally sums weights and majorities use votes. The quorum is a percentage of
active members, measured in ballots cast (people, not weights); the member
count is frozen on the resolution when voting closes. The PDF
is built with pdfkit + qrcode; Amharic lines are included when
`assets/fonts/NotoSansEthiopic-Regular.ttf` is present (it is in the repo).

**Help and language.** Every screen has a **?** button (top right) that opens
step-by-step guides for the current role: admins get the full assembly
workflow (setup, credentials, resolutions, opening and closing votes, reports,
troubleshooting); members get registering, voting and results. Next to it, the
language button switches between **English and Amharic**; the choice is
remembered on the device and the Telegram client language (`am`) is used as
the default. Translations live in `public/app/i18n.js` (English text is the
key) and the guides in `public/app/help.js`; `npm run test:i18n` fails if a
string in `app.js` has no Amharic entry. Bot chat messages and server-generated
text (dates, posted results, reports) are English only.

Everything below can be done without typing a command: the bot's **Open app**
menu button (and `/admin`) opens a Telegram Mini App served from `/app/`.

- **Admins** get a panel with Home (stats, live tallies), Resolutions (create
  with a form, open with a deadline picker, announce by choosing a topic from a
  list, send the ballot to all members, close, post results), Members (search,
  detach/unlock/deactivate, generate credentials — CSV delivered to the
  admin's own chat), Broadcast, Report and Setup (health checklist, webhook
  registration, linked group and topics, additional admins, audit log).
- **Members** register with token + password input fields, vote by tapping an
  option and confirming, and see results once voting closes.
- **Security:** every API call carries Telegram's signed `initData`, verified
  server-side with the bot token (HMAC-SHA256, 24 h max age). Admin routes
  additionally require the user to be in `ADMIN_TELEGRAM_IDS` or the `admins`
  table. The server never returns interim counts to members, and secret
  ballots stay unlinked exactly as before — the app reuses the same services
  and the same `cast_vote()` function.
- **Topics ("rooms"):** the bot records the group and its forum topics from
  the updates it sees (bot added as admin, topic created/edited, any message in
  a topic). The admin picks a topic from that list when announcing; results are
  published to the same topic on close. Renaming a topic in the Mini App also
  renames it in the group when the bot holds the "Manage topics" admin right;
  without it the new name is kept as an app-side label and the admin is told so.
  When the bot is removed from the group, the group and its topics are
  forgotten (also checked whenever Setup loads); Setup has an "Unlink group"
  button for doing it by hand. When the bot is made an administrator of the
  linked group (with the "Ban users" right) it locks the member permissions
  Telegram switches on by default — adding members, changing the group info,
  pinning, creating topics, posting polls — so only admins keep them; Setup
  shows the state and has a "Lock group for members" button to re-apply it.
  `LOCK_GROUP_PERMISSIONS=off` disables the automatic lock.
- **Sign-in topic:** when the bot becomes admin of the linked (forum) group it
  creates a "📝 Register / Sign in" topic, posts a sign-in card there and pins
  it. The card's "Register with your code" button opens the bot's private
  chat (`t.me/<bot>?start=register`) — or the Mini App directly when
  `MINI_APP_SHORT_NAME` names the app configured in BotFather — where the
  member enters code and password unseen by the group. Setup › "Post sign-in
  topic" re-posts it; without topics or the "Manage topics" right the card
  goes to the main chat.
- **Into the group after registering:** the "Registration complete" message
  (chat or app) carries an "Open the assembly group" button — the group's
  public link, or an invite link the bot creates once with join requests on
  (`createChatInviteLink`, needs "Invite users"), which the gate approves
  immediately for registered members. `GET /me` returns it as `group_link`
  and the app shows the same button above the ballots.
- **Commands in the group:** `/vote`, `/status`, `/register`, `/help` typed in
  any topic get a short English + Amharic pointer with a button into the
  private chat (`t.me/<bot>?start=vote|status|register`); nothing personal is
  shown in the group. The same four commands are registered in the group's
  "/" menu (English, and Amharic for Amharic clients), offered as a persistent
  reply keyboard, and listed with descriptions in a pinned "📖 Commands /
  ትዕዛዞች" topic the bot creates when it becomes admin (tapping a command
  in the text runs it). Setup › "Post command reference" re-posts it.
- **Starting over:** when the bot is removed from the linked group (Telegram
  sends the same event for a deleted group), it forgets the group and sends
  every admin a message with the current counts and a "Reset assembly data"
  button (two taps). The reset wipes councils, members, invitations,
  resolutions with ballots and votes, learned topics, group people and the
  group settings; admin accounts and the audit log stay, and the reset is
  audited. Setup › "Reset assembly data" does the same; the switch "Wipe
  everything automatically when the bot is removed" (`group_reset_mode`)
  makes removal itself trigger the wipe — off by default, because an
  accidental removal would then destroy the roster.
- **Group gate:** only registered members and admins belong in the assembly
  group. The bot receives `chat_member` and `chat_join_request` updates: a
  join request from a registered member is approved at once; anyone else is
  told to register first (the request stays pending and is approved
  automatically once they register, or by an admin). Someone who joins or is
  added without being registered is reported to the admins by private message
  with "Remove" / "Register in Setup" buttons — or removed immediately when the
  Setup switch "Remove unregistered people automatically" is on. Telegram gives
  bots no member list, so the bot records the people it sees (joins, requests,
  posts) in `group_people`; Setup › "People in the group" lists the
  unregistered ones, and an admin can register a person there (name, council,
  role) — the Telegram account is linked immediately, no code to type — or
  approve, decline or remove them. Needs the "Ban users" right (removals) and
  "Invite users" right (approvals).
- **Tests:** `npm run test:mock` runs a 145-check end-to-end scenario against
  an in-memory database and a mocked Telegram API (setup, rooms, login,
  lockout, voting in both ballot types, auto-close, reports, admin management).
  `TEST_DATABASE_URL=postgres://… npm run test:pg` runs the same scenario
  against a real PostgreSQL (it truncates every table — use a throwaway DB).

Code: `src/http/` (router, initData auth, JSON API), `public/app/` (the page),
`src/bot/group.ts` (topic learning), `src/bot/setup.ts` (menu button/webhook),
`src/pgclient.ts` (PostgreSQL query builder), `db/schema.sql` (schema, applied
at start-up).

## 7. Running a vote (admin workflow)

The Mini App does all of this with buttons (see 6b). The equivalent commands
work in a private chat with the bot, except `/announce`, which you run
**inside the group topic** where the vote belongs.

```
/newres Where should JOTA-JOTI 2026 be hosted? | Select the host city for this year's JOTA-JOTI event. | Addis Ababa | Hawassa | Bahir Dar | Adama
/secret R1 off        (optional — make it an open ballot; secret is the default)
/open R1              (manual close later with /close)
/announce R1          ← run this inside the JOTA-JOTI topic
/broadcast Voting on R1 (JOTA-JOTI host city) is now open — tap /vote
/results R1           (interim tally, admin-only)
/close R1             (closes voting; final results auto-post to the topic)
/reopen R1 [for 30m]  (closed too early? reopen; ballots already cast are kept)
```

**Scheduled auto-close** — give `/open` a deadline instead of closing manually
(times are East Africa Time; configurable via `TZ_OFFSET_MINUTES`):

```
/open R1 until 17:00               today at 17:00 EAT
/open R1 until 2026-08-14 17:00    explicit date
/open R1 for 90m                   duration (also: for 2h, for 1h 30m)
```

The ballot card shows the deadline to members. A scheduler checks every 30
seconds; at the deadline the resolution closes, final results post to its
topic, and all admins get a DM. `/close` still works at any time to end early.

Member experience: they tap **“Vote in private chat”** on the announcement (or
send `/vote` to the bot), tap an option button, and get a confirmation.

### Reports

`/report` (admin, private chat) generates a comprehensive assembly report and
sends two downloadable files in Telegram:

- **CSV** — one row per resolution option (status, ballot type, open/close
  times, ballots cast, turnout %, votes, winner flag) for Excel/Sheets.
- **HTML** — a formatted, print-ready document (open in a browser → print to
  PDF) with per-resolution result tables, bar charts, turnout, and an
  integrity statement. Suitable for filing with assembly minutes.

`/report email` additionally emails both to a designated address. Configure
once in the environment (works locally and on AletCloud):

```
RESEND_API_KEY=re_...          # free account at https://resend.com
REPORT_EMAIL_FROM=...          # a sender verified in Resend (onboarding@resend.dev for testing)
REPORT_EMAIL_TO=office@...     # the designated secure recipient
```

## 8. Demo runbook (leadership presentation, ~15 min)

1. **Before the meeting:** deploy on AletCloud; generate ~10 credentials; hand
   a credential slip to each participating leader; create the JOTA-JOTI
   resolution as a draft.
2. **Registration (3 min):** each leader opens the bot, sends `/start`, enters
   their token and password. Show `/stats` climbing on the projector.
3. **Open the vote (1 min):** `/open R1`, then `/announce R1` in the JOTA-JOTI
   topic, then a `/broadcast`. Everyone gets the ballot instantly.
4. **Vote (3 min):** leaders vote on their phones. Demonstrate the safeguards
   live: tap a second option on a secret ballot → *"already voted"*; try a
   wrong password on a spare token → lockout counter.
5. **Results (2 min):** `/results R1` for an interim tally, then `/close R1` —
   final results with bar chart post automatically into the topic.
6. **Talking points:** secret vs open ballots, one-token-one-vote, audit log
   (show **Setup → Audit log** in the Mini App), data hosted in Ethiopia,
   multi-day support (resolutions stay listed in `/status` across days;
   nothing is lost on restarts).

## Command reference

| Members (private chat) | Admins |
|---|---|
| `/start` — register / welcome | `/admin` — open the admin panel (`/admin help` lists commands) |
| `/vote` — open resolutions | `/newres`, `/listres`, `/secret` |
| `/status` — my ballots | `/open [until HH:MM \| for 90m]`, `/close` |
| `/help` | `/announce`, `/results`, `/report [email]` |
| `/whoami` — my Telegram ID | `/stats`, `/broadcast`, `/unbind` |

## Operational notes

- **Multi-day assembly:** all state lives in PostgreSQL; restarts/redeploys
  are safe at any time. Only an in-progress login prompt is lost (member just
  sends `/start` again).
- **Auto-close:** the AletCloud app is always on, so the 30-second deadline
  scheduler runs continuously. `/api/tick?key=<CRON_SECRET>` exists as a
  belt-and-braces endpoint for an external pinger; it is not required.
- **Schema upgrades:** applied automatically at start-up from `db/schema.sql`
  (set `AUTO_MIGRATE=0` to disable). `db/migrations/` keeps the historical
  increments for reference.
- **Backups:** the managed database is backed up daily by AletCloud (7-day
  retention on the Solo plan). Export the assembly report after each event.
- **Lost phone / changed account:** `/unbind ESA-2026-XXXXX`, member registers
  again with the same credentials.
- **Scale:** comfortably handles thousands of members; broadcasts are
  rate-limited to stay within Telegram's limits (~25 msg/s ⇒ 1000 members ≈ 40 s).
- **Verification without identity:** turnout (ballot count) is always known,
  and for secret ballots `count(ballots) = count(votes)` is an integrity check
  you can show auditors.

# TELEGRAM CONFIGURATION

## BOT NAME 
ESA Voting System

## BOT USERNAME
esa_2026_2019_voting_bot

## TOKEN
SEE .env
