import { readFile } from "node:fs/promises";
import { createClient } from "./pgclient.js";
import { config } from "./config.js";

/**
 * Database client. The name `supabase` is historical: the services were written
 * against supabase-js, and src/pgclient.ts keeps that call surface on top of a
 * plain PostgreSQL connection (DATABASE_URL). See pgclient.ts.
 */
export const supabase = createClient(config.databaseUrl, { ssl: config.databaseSsl });

/**
 * Apply db/schema.sql. Every statement in it is idempotent (create ... if not
 * exists / create or replace), so this runs at each start-up: the managed
 * database is reachable only from inside the hosting platform, so there is no
 * other convenient way to run migrations against it.
 */
export async function ensureSchema(): Promise<void> {
  const sql = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
  await supabase.exec(sql);
}

export async function audit(actor: string | number, action: string, details?: unknown): Promise<void> {
  try {
    const { error } = await supabase.from("audit_log").insert({
      actor: String(actor),
      action,
      details: details ?? null,
    });
    if (error) throw error;
  } catch (err) {
    console.error("audit log failed:", err);
  }
}
