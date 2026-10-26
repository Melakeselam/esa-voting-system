# ESA Voting System — Setup Guide

Complete walkthrough from zero to a live, deployed voting bot. Follow the parts
in order — each one takes 5–15 minutes. Written for Windows/PowerShell; the
commands are the only OS-specific part.

**What you'll end up with:** a Telegram bot running on AletCloud (Ethiopian
cloud hosting, so member data stays in the country), backed by a managed
PostgreSQL database, connected to your assembly supergroup, with admin access
for you and test credentials ready for a demo.

---

## Part 1 — Create the bot on Telegram (5 min)

1. In Telegram, search for **@BotFather** (verified, blue check) and open a chat.
2. Send `/newbot`.
3. BotFather asks for a **display name** — enter e.g. `ESA Assembly Voting`.
4. It then asks for a **username**, which must end in `bot` and be unique —
   e.g. `esa_voting_bot` or `esa_assembly_2026_bot`.
5. BotFather replies with the **HTTP API token**, which looks like
   `8123456789:AAH8s...xyz`. Copy it somewhere safe.
   **This token is the master key to your bot — never share it, never commit
   it to Git.**
6. Optional polish (all via BotFather, `/mybots` → select your bot → Edit Bot):
   - **Edit Botpic** — upload the ESA logo.
   - **Edit Description** — e.g. *"Official secure voting system for the ESA
     General Assembly. Send /start to register with your voting token."*
   - **Edit About** — one line shown on the bot's profile.

> The bot's command menu (`/vote`, `/status`, …) is registered automatically by
> the backend on startup — nothing to configure in BotFather.

## Part 2 — Create the assembly supergroup with topics (5 min)

1. In Telegram: **New Group** → add at least one other person (you can remove
   them later) → name it e.g. `ESA General Assembly 2026`.
2. Open the group → tap its name → **Edit** → enable **Topics**. The group
   becomes a forum-style supergroup with a *General* topic.
3. Create one topic per voting theme, for example:
   - `📌 Announcements`
   - `🗳 Day 1 — Resolutions`
   - `📡 JOTA-JOTI`
4. **Add the bot as an admin:** group name → **Edit** → **Administrators** →
   **Add Administrator** → search your bot's username → grant at least
   **Delete messages** (used to tidy up `/announce` commands) and leave
   **Manage topics** on if offered. Save.
5. Add your voting members to the group (or share the invite link). Members do
   **not** need any special rights — voting happens in their private chat with
   the bot; the group topics are where ballots are announced and results
   published.

## Part 3 — The database (5 min)

The app stores everything in PostgreSQL and reads the connection string from
`DATABASE_URL`. It applies `db/schema.sql` **by itself at every start-up**
(every statement is "create if not exists"), so you never run SQL by hand —
not on first install, not after upgrades.

**For local testing (Part 4)** — the quickest PostgreSQL is Docker Desktop:

```powershell
docker run -d --name esa-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=esa_voting -p 5432:5432 postgres:16
```

Your local connection string is then
`postgres://postgres:postgres@localhost:5432/esa_voting`.
(Any other PostgreSQL 14+ works too — just adjust the string.)

**For production** — the AletCloud managed database, created in Part 6. It
has no public address: only apps in the same AletCloud project can reach it,
and AletCloud fills in `DATABASE_URL` for the app when you link the two.

## Part 4 — Run locally first (10 min)

Test everything on your PC before deploying — the bot runs in long-polling
mode locally, so no public URL is needed.

```powershell
cd c:\DATABASE\EsaNationalVotingSystem
npm install
copy .env.example .env
```

Open `.env` and fill in:

```
BOT_TOKEN=8123456789:AAH8s...                                   (from Part 1)
DATABASE_URL=postgres://postgres:postgres@localhost:5432/esa_voting  (from Part 3)
ADMIN_TELEGRAM_IDS=                                             (leave empty for now)
```

Start it:

```powershell
npm run dev
```

You should see `Database schema is up to date.` and then
`@your_bot is live (long polling).`

**Make yourself admin:**

1. Open a private chat with your bot in Telegram → send `/start` → then `/whoami`.
2. It replies with your Telegram ID, e.g. `123456789`.
3. Stop the bot (Ctrl+C), set `ADMIN_TELEGRAM_IDS=123456789` in `.env`
   (comma-separate multiple admins), start again with `npm run dev`.
4. Send `/admin` — you should now see the admin command list.

**Generate test credentials and run a full dry run:**

```powershell
npm run gen:credentials -- --count 5
```

This inserts 5 members into the database and writes their plaintext
token+password pairs to `out\credentials-....csv`. Then, in Telegram:

1. Register: send `/start` to the bot, enter a token from the CSV, then its
   password. (You can register yourself with one of the test tokens.)
2. Create a vote:
   `/newres Test resolution | - | For | Against | Abstain`
   Optional voting rules (while still a draft):
   - `/quorum R1 3` — at least 3 ballots must be cast or the result is invalid
   - `/threshold R1 2/3` — adoption needs a 2/3 majority instead of a simple
     majority (an option named *Abstain* counts toward quorum but not the
     majority)
3. `/open R1 for 10m` → `/announce R1` *(run inside a group topic)*
4. Tap **Vote in private chat** on the announcement → tap an option →
   **✅ Confirm vote** (or **↩️ Back** to change your selection).
5. `/results R1` → `/close R1` (or wait for the auto-close) → results appear
   in the topic, including quorum status and an **ADOPTED / Not adopted**
   verdict.
6. `/report` → you receive the CSV + HTML report files.

If all of that works, the system is healthy — the deployment behaves
identically.

**Automated tests** (no Telegram or database needed):

```powershell
npm run test:mock                                   # 113 checks, in-memory database + mocked Telegram
$env:TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/esa_voting"; npm run test:pg
```

`test:pg` runs the same scenario against a real PostgreSQL — **it truncates
every table first**, so point it at a throwaway database, never at production.

## Part 5 — Push the code to GitHub (5 min)

AletCloud builds the app from a Git repository.

1. Create a **private** repository on [github.com/new](https://github.com/new)
   — e.g. `esa-voting-system`. Don't initialize it with a README.
2. In the project folder:

```powershell
git init
git add .
git commit -m "ESA General Assembly voting system"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/esa-voting-system.git
git push -u origin main
```

> `.gitignore` already excludes `.env` and `out/` (credentials), so no secrets
> are pushed. Double-check with `git status` before committing if unsure.

## Part 6 — Deploy on AletCloud (15 min)

AletCloud ([aletcloud.com](https://aletcloud.com)) hosts both the app and the
database inside Ethiopia. The **Solo** plans used here are free: one app with
256 MB RAM and a 1 GB PostgreSQL database with daily backups — ample for an
assembly.

1. **Sign in** to the AletCloud dashboard with the association's account.
2. **Connect GitHub:** in the dashboard, authorise AletCloud on the GitHub
   account that owns the repository (the dashboard asks for this the first
   time you deploy from a private repository). A public repository needs no
   authorisation.
3. **Project:** create a project named `esa-voting` (if it does not exist
   yet). Its primary domain becomes `https://esa-voting.app.aletcloud.com`.
4. **Database:** in the project → **Databases → New** → engine
   **PostgreSQL 16**, plan **Solo**, name `esa-voting-db`. Wait until it shows
   **RUNNING** (about a minute).
5. **App:** in the project → **Deploy app** → choose the repository, branch
   `main`, root directory `.`, framework **Node.js**, plan **Solo**, port
   `3000`. Build command `npm ci && npm run build`, start command `npm start`
   (both are what `package.json` declares, so the defaults work).
6. **Link the database to the app** (app → Databases → link `esa-voting-db`).
   This injects `DATABASE_URL` into the app's environment.
7. **Environment variables** (app → Environment). Add:

   | Variable | Value |
   |---|---|
   | `BOT_TOKEN` | from Part 1 |
   | `ADMIN_TELEGRAM_IDS` | your ID(s) from Part 4, comma-separated |
   | `WEBHOOK_SECRET` | any 40+ random letters and digits (e.g. generate one in your password manager) |
   | `PUBLIC_URL` | `https://esa-voting.app.aletcloud.com` (the app's URL, no trailing slash) |
   | `DATABASE_URL` | filled in by step 6 — leave it |
   | `RESEND_API_KEY`, `REPORT_EMAIL_FROM`, `REPORT_EMAIL_TO` | optional, only for `/report email` (Part 7) |

   > Enter variables in the dashboard rather than through automation — values
   > entered in the dashboard are injected reliably on every build. The first
   > build usually starts before the variables exist; that is fine (next step).

8. **Stop the local bot first** (Ctrl+C on `npm run dev`) — only one instance
   may talk to Telegram at a time.
9. **Deploy / restart** and watch the app logs. Until the variables are set
   the app serves a "not configured" page listing what is missing (and stays
   **LIVE**, so the platform does not restart-loop it). After a restart with
   everything set, success looks like:

   ```
   Database schema is up to date.
   HTTP server listening on :3000
   Webhook set to https://esa-voting.app.aletcloud.com/telegram — @esa_voting_bot is live.
   Mini App: https://esa-voting.app.aletcloud.com/app/
   ```

   The bot registers its own webhook, command menu and **Open app** button on
   boot — no manual webhook setup, ever. (If you ever need to re-register,
   open `https://esa-voting.app.aletcloud.com/api/setup?key=YOUR_WEBHOOK_SECRET`
   in a browser; it is harmless to repeat.)
10. **Verify:** open `https://esa-voting.app.aletcloud.com/` in a browser (a
    small landing page), then in Telegram send `/admin` to the bot → **Open
    admin panel** → **Setup** shows green checks for database, webhook and
    secret.

**Updating the app later:** push to `main` — AletCloud rebuilds and redeploys
automatically (watch the app status go BUILDING → LIVE). All voting data lives
in the database, so deploys are safe mid-assembly. The schema is re-applied at
every start, so upgrades need no manual SQL.

**Database access:** the managed database is private to the project. To look
at raw rows, use the Mini App's **Setup → Audit log** and **Members** tabs, or
the assembly report; the dashboard's database page shows status, backups and
credentials (treat the credentials as a secret, rotate them if they ever
leak).

## Part 6b — Keeping the deployment healthy

- **Logs:** dashboard → app → Logs. Every request handler error and every
  Telegram failure is logged with its cause.
- **Restart:** dashboard → app → Restart (needed after changing environment
  variables).
- **Backups:** the database is backed up daily (7-day retention). The
  assembly report (Part 7) is the long-term archive — generate it after every
  event.
- **Status:** `https://esa-voting.app.aletcloud.com/healthz` returns `ok`
  when the app is running; the Mini App's **Setup** tab shows the full
  checklist.

## Part 6c — The Mini App (admin panel and voting)

The whole system is operated from a Telegram **Mini App** — a page that opens
inside Telegram with buttons and forms instead of typed commands. The slash
commands still work for anyone who prefers them.

**Opening it**

- Admins: send `/admin` to the bot and tap **Open admin panel**, or tap the
  **Open app** menu button next to the message box.
- Members: the same menu button opens their voting view (register → vote →
  results). Group announcements still carry the "Vote in private chat" link.
- Only people whose Telegram account is in `ADMIN_TELEGRAM_IDS`, or who were
  added under **Setup → Admins**, see the admin panel. The app proves identity
  with Telegram's signed `initData`; nothing to log into.

**Admin panel map**

| Tab | What you do there |
|---|---|
| **Home** | Registration count, open/closed totals, open votes with live tallies, quick actions |
| **Resolutions** | Create (title, description, options, secret/open ballot, quorum, majority), edit/delete drafts, **Open voting** (no deadline / after N minutes / at a time), **Announce in a topic** (pick the room from a list), **Send ballot to all members**, post interim/final results, **Close voting** |
| **Members** | Search and filter members; detach a Telegram account (lost phone), unlock, deactivate/reactivate; **Generate credentials** by names or count — the CSV with passwords is sent to *your* chat only |
| **Setup** | Health checklist (database tables, webhook, secrets, scheduler mode, email), register webhook/menu button, linked group and its **topics** (rename, test message, add by ID), admins (add/remove), audit log |

**Topics ("rooms").** The bot learns the assembly group when it is added as an
admin, and learns each topic when a topic is created or when it sees a message
in it. Before the assembly, post a short message in each topic so they all
appear in the picker; rename them in Setup if a name was not captured.

**Testing without Telegram or a database.** `npm run test:mock` runs a
113-check scenario against an in-memory database and a mocked Telegram API:
secure setup, group/topic learning, credential generation, registration (app
and chat, lockout, token conflicts), announcements into different topics,
secret and open ballots, double-vote guard, chat-button voting, close and
auto-close with results in the right topic, broadcast, report, admin
management and the audit trail. Run it after any code change; `npm run
test:pg` (Part 4) runs the same checks against a real PostgreSQL.

## Part 7 — Prepare for the real event

1. **Generate real credentials:** in the admin panel → **Members → ＋
   Credentials**, paste one `Full Name, Region` per line (or choose a count),
   tap **Generate**. The CSV with the plaintext passwords is sent to your
   private chat with the bot — the only copy. Distribute one row per member
   via a secure channel (sealed envelope, SMS, in-person at accreditation),
   then **delete the file from the chat**. (The command line
   `npm run gen:credentials -- --names members.csv` still works too.)
2. **Registration window:** ask members to register (menu button → token and
   password, or `/start` in the chat) the day before voting. Track progress on
   the **Home** tab.
3. **Per resolution:** Resolutions → **＋ New** → set quorum and majority
   while it is a draft → **Open voting** (choose a deadline) → **Announce** in
   the right topic → optionally **Send ballot to all members**.
4. **After the assembly:** Home → **Assembly report** (with email if
   configured) for the archive. Decide when to purge member data (Members →
   deactivate, or ask the maintainer to truncate the tables) in line with the
   association's data-retention policy.

---

## Troubleshooting

| Symptom | Cause & fix |
|---|---|
| App shows "not configured" page | One or more required variables are empty — the page names them. Set them in the dashboard (app → Environment) and restart the app. |
| Bot doesn't reply at all | Check the app logs. Most common: wrong `BOT_TOKEN` (401 in logs) — fix the variable, restart. |
| Worked locally, dead after deploy | Local `npm run dev` still running and holding a polling conflict (409 in logs) — stop it; the webhook takes over on the next restart. |
| `/admin` says nothing / no admin commands | Your Telegram ID isn't in `ADMIN_TELEGRAM_IDS`. Send `/whoami` to the bot, add the ID (commas only, no spaces issues), restart. |
| Results don't appear in the topic on `/close` | The bot isn't an admin of the group, or `/announce` was never run for that resolution (the bot posts results where it was announced). |
| `relation "members" does not exist` / database errors in logs | The schema is applied at start-up; if it failed the log line before it says why (usually a wrong `DATABASE_URL`). Fix and restart. |
| `connect ECONNREFUSED` / `ENOTFOUND` for the database | `DATABASE_URL` points at the wrong host, or the database is stopped — check its status in the dashboard. |
| `/report email` fails | Sender not verified in Resend, or the three email env vars aren't all set. The Telegram file delivery always works regardless. |
| Member lost phone / new Telegram account | Admin: `/unbind ESA-2026-XXXXX`, member registers again with the same credentials. |
| Token locked | 5 wrong passwords → locked 15 min automatically. Wait, or verify the member has the right slip. |

## Security checklist before go-live

- [ ] `BOT_TOKEN`, `WEBHOOK_SECRET` and `DATABASE_URL` exist only in the AletCloud app environment + your local `.env`
- [ ] GitHub repository is **private**
- [ ] Credentials CSV distributed and **deleted** from your machine and from the Telegram chat
- [ ] `ADMIN_TELEGRAM_IDS` contains only the officials who should control votes
- [ ] Test resolution created, voted on, closed, and report generated end-to-end on the deployed app
- [ ] Member data stays on AletCloud (Ethiopia); no copies of the database exported abroad
