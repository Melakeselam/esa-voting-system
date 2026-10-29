import { createServer } from "node:http";
import { config, missingConfig } from "./config.js";

/**
 * Long-lived Node server (AletCloud, or any VM) and local development.
 */
async function main(): Promise<void> {
  if (missingConfig.length > 0) return startPlaceholder();

  const [{ bot, ensureBotReady }, { startAutoCloseScheduler }, setup, { handleHttp }, { ensureSchema }] =
    await Promise.all([
      import("./bot/instance.js"),
      import("./bot/lifecycle.js"),
      import("./bot/setup.js"),
      import("./http/router.js"),
      import("./db.js"),
    ]);
  const { ALLOWED_UPDATES, registerTelegramSurface, registerWebhook } = setup;

  if (process.env.AUTO_MIGRATE !== "0") {
    await ensureSchema();
    console.log("Database schema is up to date.");
  }
  const server = createServer((req, res) => {
    handleHttp(req, res).catch((err) => {
      console.error("request handler error:", err);
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.end();
      }
    });
  });

  if (config.publicUrl) {
    // ---- Production: webhook mode behind an HTTPS URL ----
    if (!config.webhookSecret) {
      console.error("WEBHOOK_SECRET must be set in webhook mode.");
      process.exit(1);
    }
    // Open the port first: the platform's probes and Telegram's webhook
    // deliveries get answered even when the Telegram API is slow to respond
    // to the registration calls (seen 2026-10-28: a pod sat for 3 minutes
    // between the schema check and listening and was restarted by the probe).
    // Request handlers await ensureBotReady() themselves.
    server.listen(config.port, async () => {
      console.log(`HTTP server listening on :${config.port}`);
      try {
        await ensureBotReady();
        await registerTelegramSurface(bot);
        await registerWebhook(bot);
        console.log(`Webhook set to ${config.publicUrl}/telegram — @${bot.botInfo.username} is live.`);
        console.log(`Mini App: ${config.publicUrl}/app/`);
      } catch (err) {
        console.error("Failed to register with Telegram:", err);
      }
      startAutoCloseScheduler(bot.api);
    });
  } else {
    // ---- Local development: long polling; HTTP server still serves the Mini App on localhost ----
    await ensureBotReady();
    await bot.api.deleteWebhook({ drop_pending_updates: false });
    await registerTelegramSurface(bot);
    startAutoCloseScheduler(bot.api);
    server.listen(config.port, () => {
      console.log(`HTTP server listening on :${config.port} (Mini App at http://localhost:${config.port}/app/ — ` +
        `Telegram needs an HTTPS URL, so set PUBLIC_URL to a tunnel to test the app locally).`);
    });
    console.log("Starting in long-polling mode (local development)…");
    await bot.start({
      allowed_updates: [...ALLOWED_UPDATES],
      onStart: (me) => console.log(`@${me.username} is live (long polling).`),
    });
  }
}

/**
 * Required environment variables are missing (typically the first deploy,
 * before they were entered in the hosting dashboard). Instead of crashing —
 * which the hosting platform would treat as a failed, restart-looping
 * container — serve a page that says what is missing and answer 200 to the
 * readiness probe. Once the variables are set, redeploy/restart the app.
 */
function startPlaceholder(): void {
  const missing = missingConfig.join(", ");
  console.error(`Not configured — missing environment variable(s): ${missing}`);
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/healthz")) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, missing: missingConfig }));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>ESA Voting — not configured</title>` +
        `<body style="font-family:system-ui;max-width:40rem;margin:3rem auto;padding:0 1rem">` +
        `<h1>ESA Voting System</h1><p>The service is deployed but not configured yet.</p>` +
        `<p>Missing environment variable(s): <code>${missing}</code></p>` +
        `<p>Set them in the hosting dashboard and restart the app.</p></body>`,
    );
  });
  server.listen(config.port, () => console.log(`Placeholder server listening on :${config.port}`));
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
