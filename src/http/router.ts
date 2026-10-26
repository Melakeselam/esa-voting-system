import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { audit } from "../db.js";
import { bot, ensureBotReady } from "../bot/instance.js";
import { autoCloseDue, tickAutoClose } from "../bot/lifecycle.js";
import { registerTelegramSurface, registerWebhook } from "../bot/setup.js";
import { handleAppApi } from "./app-api.js";
import { serveStatic } from "./static.js";
import { HttpError, json, readJsonBody, text } from "./util.js";

/**
 * Framework-agnostic HTTP entry point used by the Node server (src/server.ts).
 * It is also usable as a serverless function handler (config.serverless).
 *
 *   POST /telegram        Telegram webhook (secret-token protected)
 *   GET  /               landing page (200 — the hosting readiness probe hits this)
 *   GET  /healthz         liveness
 *   GET  /api/tick        auto-close due resolutions (external cron; optional, the server has its own scheduler)
 *   GET  /api/setup       one-time: register webhook, commands and menu button
 *   *    /api/app/...     Mini App JSON API (Telegram initData auth)
 *   GET  /app/...         Mini App static files (Node server only)
 */
export async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = (req.method ?? "GET").toUpperCase();

  try {
    if (path === "/telegram" && method === "POST") return await handleWebhook(req, res);
    if (path === "/healthz") return text(res, 200, "ok");
    if (path === "/api/tick") return await handleTick(req, res, url);
    if (path === "/api/setup") return await handleSetup(req, res, url);
    if (path === "/api/app" || path.startsWith("/api/app/")) {
      if (config.serverless) await tickAutoClose(bot.api);
      return await handleAppApi(req, res, path.slice("/api/app".length) || "/", method, url.searchParams);
    }
    if (path === "/") return landing(res);
    if (path === "/app" || path.startsWith("/app/")) return await serveStatic(req, res, url.pathname);
    text(res, 404, "Not found");
  } catch (err) {
    if (err instanceof HttpError) {
      json(res, err.status, { error: err.message, code: err.code });
      return;
    }
    console.error(`${method} ${path} failed:`, err);
    if (!res.headersSent) json(res, 500, { error: "Internal error" });
    else res.end();
  }
}

/**
 * Answers 200 with a link to the Mini App. The hosting platform's readiness
 * probe requests `/` and treats a redirect as a failure, so this is not a 302.
 */
function landing(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
  res.end(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>ESA Voting System</title>` +
      `<body style="font-family:system-ui;max-width:40rem;margin:3rem auto;padding:0 1rem">` +
      `<h1>Ethiopia Scout Association — Voting System</h1>` +
      `<p>This service powers the assembly voting bot on Telegram.</p>` +
      `<p><a href="/app/">Open the Mini App</a> (works inside Telegram).</p></body>`,
  );
}

function secretMatches(given: string | undefined, expected: string): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const header = req.headers["x-telegram-bot-api-secret-token"];
  if (!secretMatches(typeof header === "string" ? header : undefined, config.webhookSecret)) {
    throw new HttpError(401, "Bad secret token");
  }
  const update = await readJsonBody(req);
  if (!update || typeof update !== "object") throw new HttpError(400, "Expected a Telegram update");

  await ensureBotReady();
  await bot.handleUpdate(update as Parameters<typeof bot.handleUpdate>[0]);
  // Serverless: no background scheduler, so piggy-back deadline checks on traffic.
  if (config.serverless) await tickAutoClose(bot.api);
  text(res, 200, "ok");
}

/** Accepts `?key=`, `Authorization: Bearer <key>` (Vercel cron sends CRON_SECRET this way). */
function cronAuthorized(req: IncomingMessage, url: URL): boolean {
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  return secretMatches(url.searchParams.get("key") ?? bearer, config.cronSecret);
}

async function handleTick(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (!cronAuthorized(req, url)) throw new HttpError(401, "Unauthorized");
  await ensureBotReady();
  const closed = await autoCloseDue(bot.api);
  json(res, 200, { ok: true, closed, at: new Date().toISOString() });
}

/**
 * First-time wiring on a serverless deployment, where nothing runs at boot:
 * open https://<host>/api/setup?key=<WEBHOOK_SECRET> once in a browser.
 */
async function handleSetup(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (!cronAuthorized(req, url)) throw new HttpError(401, "Unauthorized");
  await ensureBotReady();
  await registerTelegramSurface(bot);
  const webhook = config.publicUrl ? await registerWebhook(bot) : null;
  await audit("system:setup", "webhook_registered", { url: webhook?.expected ?? null, via: "setup-url" });
  json(res, 200, {
    ok: true,
    bot: `@${bot.botInfo.username}`,
    public_url: config.publicUrl,
    app_url: config.publicUrl ? `${config.publicUrl}/app/` : null,
    webhook,
    admins: config.adminIds.length,
    next: config.publicUrl
      ? "Open Telegram, send /admin to the bot, and tap 'Open admin panel'."
      : "PUBLIC_URL is not set, so the webhook was not registered.",
  });
}
