import type { Api } from "grammy";
import { audit } from "../db.js";
import { config } from "../config.js";
import { claimClose, listDueForClose } from "../services/resolutions.js";
import { ballotCount, tally } from "../services/votes.js";
import { resultsText } from "./ui.js";
import type { Resolution } from "../types.js";

/**
 * Close a resolution and publish final results to the topic where it was
 * announced. Used by the admin /close command, the Mini App and the auto-close
 * scheduler; the conditional status update in claimClose() guarantees the
 * results are published exactly once even if they race.
 * Returns the results text, or null if the resolution was already closed.
 */
export async function closeResolution(
  api: Api,
  res: Resolution,
  closedBy: string | number,
): Promise<string | null> {
  const claimed = await claimClose(res.id);
  if (!claimed) return null;
  await audit(closedBy, "resolution_closed", { code: res.code, eligible: claimed.eligible });

  const closed = { ...res, status: "closed" as const, eligible_count: claimed.eligible };
  const [rows, ballots] = await Promise.all([tally(res.id), ballotCount(res.id)]);
  const text = resultsText(closed, rows, ballots, claimed.eligible);

  if (res.announce_chat_id) {
    try {
      await api.sendMessage(res.announce_chat_id, text, {
        parse_mode: "HTML",
        message_thread_id: res.announce_thread_id ?? undefined,
      });
    } catch (err) {
      console.error(`failed to publish ${res.code} results to announce chat:`, err);
    }
  }
  return text;
}

/**
 * Close every open resolution whose deadline has passed and whose quorum is
 * met; one without quorum stays open and the admins decide (quorum-flow.ts).
 * Returns how many closed.
 */
export async function autoCloseDue(api: Api): Promise<number> {
  const { handleDeadline } = await import("./quorum-flow.js"); // circular import: quorum-flow uses closeResolution
  const due = await listDueForClose();
  let closed = 0;
  for (const res of due) {
    const text = await handleDeadline(api, res);
    if (!text) continue;
    closed++;
    console.log(`auto-closed ${res.code} (${res.awaiting_quorum_since ? "quorum reached after the deadline" : "deadline reached"})`);
    for (const adminId of config.adminIds) {
      try {
        await api.sendMessage(
          adminId,
          (res.awaiting_quorum_since
            ? `✅ <b>${res.code}</b> reached quorum after its deadline and was closed automatically.\n\n${text}`
            : `⏰ <b>${res.code}</b> reached its deadline and was closed automatically.\n\n${text}`),
          { parse_mode: "HTML" },
        );
      } catch {
        // Admin may not have started a chat with the bot yet.
      }
    }
  }
  return closed;
}

/** Poll for due deadlines every 30 seconds (long-lived server only). */
export function startAutoCloseScheduler(api: Api): void {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await autoCloseDue(api);
    } catch (err) {
      console.error("auto-close scheduler error:", err);
    } finally {
      running = false;
    }
  }, 30_000);
}

/**
 * Serverless substitute for the scheduler: called on every incoming request,
 * but only does work at most once per interval per warm instance. An external
 * pinger hitting /api/tick every minute keeps deadlines accurate when idle.
 */
let lastTick = 0;
export async function tickAutoClose(api: Api, minIntervalMs = 20_000): Promise<number> {
  if (Date.now() - lastTick < minIntervalMs) return 0;
  lastTick = Date.now();
  try {
    return await autoCloseDue(api);
  } catch (err) {
    console.error("auto-close tick error:", err);
    return 0;
  }
}
