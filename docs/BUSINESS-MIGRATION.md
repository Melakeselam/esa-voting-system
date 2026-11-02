# Moving the Kene Voting business pages to www.kene-tech.com

The business side of Kene Voting (sign-up, creating an organisation, plans,
payments, the platform console) is built so the **pages** can move to the
company website while the **data and the API stay on AletCloud** in Ethiopia.

```
www.kene-tech.com/voting/        (pages: index.html, biz.js, biz.css)
        │  fetch() with "Authorization: Bearer <session>"
        ▼
https://esa-voting.app.aletcloud.com/api/biz/…   (Kene Voting server + PostgreSQL)
        │
        ▼
@KeneVotingBot   (sign-in confirmation, payment notices)
```

## What exists today

| Piece | Where |
|---|---|
| Pages | `public/business/` → served at `https://esa-voting.app.aletcloud.com/business/` |
| API | `src/http/biz-api.ts` → `/api/biz/*` |
| Data and rules | `src/services/billing.ts`, tables `biz_*` and the plan columns on `organizations` (`db/schema.sql`) |
| Sign-in in the bot | `src/bot/biz.ts` (`/start weblogin_<code>`) |

Sign-in works on **any** domain: the page asks the API for a one-time link
`t.me/<bot>?start=weblogin_<code>`, the person taps Start in Telegram, and the
page picks up its session (30 days). No BotFather domain setting is needed.

## Steps to move the pages

1. **Allow the website to call the API.** In the AletCloud app settings add the
   environment variable

   ```
   BUSINESS_ORIGINS=https://www.kene-tech.com,https://kene-tech.com
   ```

   then redeploy. Only origins listed there get CORS headers.

2. **Copy the three files** `public/business/index.html`, `biz.js`, `biz.css`
   into the website. In the Next.js site (`kene-technologies-website`) the
   simplest way is the `public/voting/` folder, giving
   `https://www.kene-tech.com/voting/`.

3. **Point the pages at the API.** In the copied `index.html`, before
   `biz.js`, add:

   ```html
   <script>window.KV_API_BASE = "https://esa-voting.app.aletcloud.com";</script>
   ```

4. **Share links.** Share links currently point to
   `…aletcloud.com/business/?ref=CODE`. To make them point to the website, set
   on AletCloud

   ```
   BUSINESS_PAGE_URL=https://www.kene-tech.com/voting/
   ```

   (Optional: until it is set, both addresses work — the code in `?ref=` is
   what counts.)

5. **Link it from the website.** Add "Kene Voting — run your assembly vote"
   to the products menu, pointing to `/voting/`.

6. **Keep the old address.** `…aletcloud.com/business/` keeps working; the
   Mini App's "Create your own organisation" and "Business console" buttons
   open it inside Telegram, where the person is signed in already.

Optionally, the pages can later be rebuilt as React components in the
website's own design; they only need the same `/api/biz` calls (listed at the
top of `src/http/biz-api.ts`).

## Running it locally

```
npm run build && npm start      # with the usual .env (BOT_TOKEN, DATABASE_URL, ADMIN_TELEGRAM_IDS)
open http://localhost:3000/business/
```

Signing in needs the bot to receive `/start weblogin_…`: locally the server
runs in long-polling mode, so this works as long as no other server holds the
same bot's webhook. With the production bot, test on the deployed address.

## Who does what

- **Platform administrators** (`ADMIN_TELEGRAM_IDS`): the console at
  `/business/#/admin` — plans and prices per country, payment accounts,
  payments to approve, organisations (extend, change the member limit, exempt),
  sign-ups and who brought whom, the member limit without a plan.
- **Creators**: anyone who signs in; they create organisations, pay, and share
  their link.
- **Organisations created by the platform administrators** (in the Mini App)
  are exempt from plans.
