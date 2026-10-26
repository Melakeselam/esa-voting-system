import { config } from "./config.js";

const pad = (n: number) => String(n).padStart(2, "0");

/** Format a timestamp in assembly local time, e.g. "2026-08-14 17:00 EAT". */
export function formatLocal(when: string | Date): string {
  const d = typeof when === "string" ? new Date(when) : when;
  const local = new Date(d.getTime() + config.tzOffsetMinutes * 60_000);
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ` +
    `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())} ${config.tzLabel}`
  );
}

/**
 * Parse a voting deadline given after a resolution code:
 *   "until 17:00"              — today at 17:00 local time
 *   "until 2026-08-14 17:00"   — explicit date, local time
 *   "for 90m" | "for 2h" | "for 1h 30m" — duration from now
 * Returns null when the text is empty (no deadline requested).
 */
export function parseDeadline(text: string): { date: Date } | { error: string } | null {
  const t = text.trim();
  if (!t) return null;

  const duration = t.match(/^for\s+(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/i);
  if (duration && (duration[1] || duration[2])) {
    const ms = (Number(duration[1] ?? 0) * 60 + Number(duration[2] ?? 0)) * 60_000;
    if (ms <= 0) return { error: "The duration must be positive, e.g. for 30m" };
    return { date: new Date(Date.now() + ms) };
  }

  const until = t.match(/^until\s+(?:(\d{4})-(\d{2})-(\d{2})\s+)?(\d{1,2}):(\d{2})$/i);
  if (until) {
    const offsetMs = config.tzOffsetMinutes * 60_000;
    const nowLocal = new Date(Date.now() + offsetMs);
    const year = until[1] ? Number(until[1]) : nowLocal.getUTCFullYear();
    const month = until[2] ? Number(until[2]) : nowLocal.getUTCMonth() + 1;
    const day = until[3] ? Number(until[3]) : nowLocal.getUTCDate();
    const hour = Number(until[4]);
    const minute = Number(until[5]);
    if (hour > 23 || minute > 59) return { error: "Invalid time of day." };
    const utcMs = Date.UTC(year, month - 1, day, hour, minute) - offsetMs;
    if (utcMs <= Date.now()) {
      return {
        error:
          `${formatLocal(new Date(utcMs))} is already in the past. ` +
          `For a future day use: until YYYY-MM-DD HH:MM`,
      };
    }
    return { date: new Date(utcMs) };
  }

  return {
    error:
      'Could not understand the deadline. Use one of:\n' +
      '  until 17:00\n  until 2026-08-14 17:00\n  for 90m   (or: for 2h, for 1h 30m)',
  };
}
