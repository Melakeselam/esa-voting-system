import "dotenv/config";

/** First non-empty value among the given environment variable names. */
function env(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return "";
}

/** Names of required variables that are not set. Checked by the server before it starts the bot. */
export const missingConfig: string[] = [];

/**
 * Record a missing required variable instead of throwing: the hosting platform
 * marks a crashing container as failed and keeps restarting it, so the server
 * starts a "not configured" placeholder instead (see server.ts).
 */
function required(name: string, ...aliases: string[]): string {
  const value = env(name, ...aliases);
  if (!value) missingConfig.push(name);
  return value;
}

// Public HTTPS base URL of the deployment, e.g. https://esa-voting.app.aletcloud.com
// (Render and Vercel expose their own variables; PUBLIC_URL overrides both).
const publicUrl =
  env("PUBLIC_URL", "RENDER_EXTERNAL_URL") ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");

export const config = {
  botToken: required("BOT_TOKEN", "TELEGRAM_BOT_TOKEN"),
  /** Override the Bot API base URL (local Bot API server, or the mock used by tests). */
  telegramApiRoot: env("TELEGRAM_API_ROOT") || null,
  /** PostgreSQL connection string (postgres://user:pass@host:5432/db). */
  databaseUrl: required("DATABASE_URL"),
  /** Set DATABASE_SSL=1 if the database requires TLS (self-signed certificates are accepted). */
  databaseSsl: /^(1|true|require)$/i.test(env("DATABASE_SSL")),
  adminIds: env("ADMIN_TELEGRAM_IDS")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0),
  /** When set, the bot runs in webhook mode; otherwise long polling (local dev). */
  publicUrl: publicUrl.replace(/\/$/, "") || null,
  /** Display name, short description and description the app applies to the bot at start-up (BotFather values are overwritten). */
  botDisplayName: env("BOT_DISPLAY_NAME") || "ESA Voting System",
  botShortDescription: env("BOT_SHORT_DESCRIPTION") || "Secure voting for the ESA General Assembly — register with your invitation and vote from your phone.",
  botDescription: env("BOT_DESCRIPTION") || "Official voting assistant of the Ethiopia Scout Association General Assembly. Register once with the invitation code and password issued by your council or the National Office, then vote on resolutions from this chat or the app.",
  webhookSecret: env("WEBHOOK_SECRET"),
  /** Protects /api/tick (auto-close) and /api/setup. Defaults to the webhook secret. */
  cronSecret: env("CRON_SECRET", "WEBHOOK_SECRET"),
  /** True on Vercel: no long-lived process, so no setInterval scheduler. */
  serverless: Boolean(process.env.VERCEL),
  port: Number(process.env.PORT ?? 3000),
  maxLoginAttempts: 5,
  lockMinutes: 15,
  /** Local time for deadlines/reports. Default: East Africa Time (UTC+3). */
  tzOffsetMinutes: Number(process.env.TZ_OFFSET_MINUTES ?? 180),
  tzLabel: process.env.TZ_LABEL ?? "EAT",
  /** Optional email delivery of reports via https://resend.com */
  resendApiKey: env("RESEND_API_KEY"),
  reportEmailFrom: env("REPORT_EMAIL_FROM"),
  reportEmailTo: env("REPORT_EMAIL_TO"),
};

/** HTTPS URL of the Mini App, or null when no public URL is configured. */
export function appUrl(): string | null {
  return config.publicUrl ? `${config.publicUrl}/app/` : null;
}

export function emailConfigured(): boolean {
  return Boolean(config.resendApiKey && config.reportEmailFrom && config.reportEmailTo);
}

/** Synchronous check against the environment list only. See services/admins.ts for the full check. */
export function isAdmin(telegramId: number | undefined): boolean {
  return telegramId !== undefined && config.adminIds.includes(telegramId);
}
