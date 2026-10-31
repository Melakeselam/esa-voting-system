import { readFile } from "node:fs/promises";
import { createClient, type DbClient } from "./pgclient.js";
import { config } from "./config.js";
import { currentOrgId, requireOrgId } from "./org-context.js";

/**
 * Database client. The name `supabase` is historical: the services were written
 * against supabase-js, and src/pgclient.ts keeps that call surface on top of a
 * plain PostgreSQL connection (DATABASE_URL). See pgclient.ts.
 *
 * `rawDb` sees every organisation. `supabase` is the same connection scoped to
 * the current organisation (org-context.ts): on the organisation tables below
 * every select, update and delete gets `org_id = <current>` and every insert
 * and upsert gets that org_id, so a service can never read or change another
 * organisation's rows by accident. Using an organisation table with no
 * organisation selected throws instead of returning everyone's data.
 */
export const rawDb: DbClient = createClient(config.databaseUrl, { ssl: config.databaseSsl });

/** Tables whose rows belong to one organisation. */
export const ORG_TABLES = new Set(["members", "councils", "resolutions", "chat_topics", "group_people", "admins", "app_settings"]);
/** Tables whose upsert key includes org_id (their natural key is only unique within an organisation). */
const ORG_IN_CONFLICT: Record<string, string> = { app_settings: "key", admins: "telegram_user_id" };

type Row = Record<string, unknown>;
const withOrgId = (rows: Row | Row[], orgId: string): Row | Row[] =>
  Array.isArray(rows) ? rows.map((r) => ({ ...r, org_id: orgId })) : { ...rows, org_id: orgId };

function scoped(raw: DbClient): DbClient {
  return {
    // Bound explicitly: the client may be a class instance (the test fake), whose methods a spread would drop.
    rpc: (name, params) => raw.rpc(name, params),
    exec: (sql) => raw.exec(sql),
    end: () => raw.end(),
    from(table: string) {
      if (!ORG_TABLES.has(table)) return raw.from(table);
      const orgId = requireOrgId(table);
      const b = raw.from(table);
      const scopedBuilder = {
        select: (cols?: string, opts?: { count?: "exact"; head?: boolean }) => b.select(cols, opts).eq("org_id", orgId),
        insert: (rows: Row | Row[]) => b.insert(withOrgId(rows, orgId)),
        update: (patch: Row) => {
          const { org_id: _ignored, ...rest } = patch; // rows never move between organisations
          return b.update(rest).eq("org_id", orgId);
        },
        delete: () => b.delete().eq("org_id", orgId),
        upsert: (rows: Row | Row[], opts: { onConflict?: string } = {}) => {
          const natural = ORG_IN_CONFLICT[table];
          const onConflict = natural ? `org_id,${opts.onConflict ?? natural}` : opts.onConflict;
          return b.upsert(withOrgId(rows, orgId), { ...opts, onConflict });
        },
      };
      return scopedBuilder as unknown as ReturnType<DbClient["from"]>;
    },
  };
}

export const supabase: DbClient = scoped(rawDb);

/**
 * Apply db/schema.sql. Every statement in it is idempotent (create ... if not
 * exists / create or replace), so this runs at each start-up: the managed
 * database is reachable only from inside the hosting platform, so there is no
 * other convenient way to run migrations against it.
 */
export async function ensureSchema(): Promise<void> {
  const sql = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
  await rawDb.exec(sql);
}

export async function audit(actor: string | number, action: string, details?: unknown): Promise<void> {
  try {
    const { error } = await rawDb.from("audit_log").insert({
      actor: String(actor),
      action,
      details: details ?? null,
      org_id: currentOrgId(), // null for platform-level actions (organisations created, …)
    });
    if (error) throw error;
  } catch (err) {
    console.error("audit log failed:", err);
  }
}
