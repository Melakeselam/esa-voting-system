/**
 * Minimal PostgREST-style query builder on top of node-postgres.
 *
 * The services were written against the supabase-js client. When the project
 * moved from Supabase to a plain managed PostgreSQL (AletCloud), this module
 * replaced that client while keeping the same call surface, so the services,
 * the Mini App API and the in-memory test fake (tests/fake-supabase.mjs) did
 * not have to change. Only the subset of the API this project uses exists:
 *
 *   from(t).select(cols, { count, head }) .eq .neq .gt .gte .lt .lte .is .not .ilike .or
 *          .order .range .limit .maybeSingle .single
 *   from(t).insert(row|rows).select(cols).single()
 *   from(t).update(patch).eq(...).select(cols)
 *   from(t).upsert(row, { onConflict }) / .delete().eq(...)
 *   rpc(name, params)
 *
 * Every builder is thenable and resolves to { data, error, count } — errors are
 * returned, never thrown, exactly like supabase-js.
 */
import pg from "pg";

const { Pool, types } = pg;

// int8 (bigint) → number: Telegram ids and count(*) fit in a JS number.
types.setTypeParser(20, (v) => Number(v));
// timestamptz → ISO string, which is what the Supabase client returned and what
// the rest of the code (and the JSON API) expects.
const parseTimestamptz = types.getTypeParser(1184);
types.setTypeParser(1184, (v) => {
  const d = parseTimestamptz(v);
  return d instanceof Date ? d.toISOString() : d;
});

export class DbError extends Error {
  code: string;
  details: string | null;
  constructor(message: string, code = "", details: string | null = null) {
    super(message);
    this.name = "DbError";
    this.code = code;
    this.details = details;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped, as in supabase-js; callers cast */
export interface DbResult<D = any> {
  /** Rows, or one row / null after maybeSingle() / single(). */
  data: D;
  error: DbError | null;
  count: number | null;
}

type Row = Record<string, unknown>;

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new DbError(`Invalid identifier: ${name}`, "42601");
  return `"${name}"`;
}

function columnList(cols: string): string {
  const trimmed = cols.trim();
  if (trimmed === "*" || trimmed === "") return "*";
  return trimmed
    .split(",")
    .map((c) => ident(c.trim()))
    .join(", ");
}

/** Convert a JS value to something node-postgres can send to the matching column type. */
function toParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === "object") return JSON.stringify(value); // jsonb columns
  return value;
}

function toDbError(err: unknown): DbError {
  if (err instanceof DbError) return err;
  const e = err as { message?: string; code?: string; detail?: string };
  return new DbError(e?.message ?? String(err), e?.code ?? "", e?.detail ?? null);
}

class Builder<D = any[]> implements PromiseLike<DbResult<D>> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private columns = "*";
  private returning: string | null = null;
  private countExact = false;
  private head = false;
  private payload: Row | Row[] | null = null;
  private onConflict: string[] = [];
  private readonly where: string[] = [];
  private readonly params: unknown[] = [];
  private ord: { col: string; asc: boolean } | null = null;
  private rng: [number, number] | null = null;
  private lim: number | null = null;
  private mode: "many" | "maybe" | "single" = "many";

  constructor(private readonly pool: pg.Pool, private readonly table: string) {}

  // ------------------------------------------------------------ operations
  select(cols = "*", opts: { count?: "exact"; head?: boolean } = {}): this {
    if (this.op === "select") this.columns = cols;
    else this.returning = cols;
    if (opts.count === "exact") this.countExact = true;
    if (opts.head) this.head = true;
    return this;
  }
  insert(rows: Row | Row[]): this { this.op = "insert"; this.payload = rows; return this; }
  update(patch: Row): this { this.op = "update"; this.payload = patch; return this; }
  delete(): this { this.op = "delete"; return this; }
  upsert(rows: Row | Row[], opts: { onConflict?: string } = {}): this {
    this.op = "upsert";
    this.payload = rows;
    this.onConflict = (opts.onConflict ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return this;
  }

  // ------------------------------------------------------------ filters
  private param(value: unknown): string {
    this.params.push(toParam(value));
    return `$${this.params.length}`;
  }
  private cmp(col: string, op: string, value: unknown): this {
    this.where.push(`${ident(col)} ${op} ${this.param(value)}`);
    return this;
  }
  eq(col: string, value: unknown): this { return this.cmp(col, "=", value); }
  neq(col: string, value: unknown): this { return this.cmp(col, "<>", value); }
  gt(col: string, value: unknown): this { return this.cmp(col, ">", value); }
  gte(col: string, value: unknown): this { return this.cmp(col, ">=", value); }
  lt(col: string, value: unknown): this { return this.cmp(col, "<", value); }
  lte(col: string, value: unknown): this { return this.cmp(col, "<=", value); }
  ilike(col: string, pattern: string): this { return this.cmp(col, "ILIKE", pattern); }
  is(col: string, value: null | boolean): this {
    this.where.push(`${ident(col)} IS ${value === null ? "NULL" : value ? "TRUE" : "FALSE"}`);
    return this;
  }
  not(col: string, op: string, value: unknown): this {
    if (op === "is") {
      this.where.push(`${ident(col)} IS NOT ${value === null ? "NULL" : value ? "TRUE" : "FALSE"}`);
      return this;
    }
    if (op === "eq") return this.cmp(col, "<>", value);
    throw new DbError(`Unsupported not(${op})`, "42601");
  }
  /** PostgREST syntax: "col.op.value,col.op.value" (op: eq | ilike). */
  or(expr: string): this {
    const parts = expr.split(",").map((p) => {
      const [col, op, ...rest] = p.split(".");
      const value = rest.join(".");
      if (op === "ilike") return `${ident(col)} ILIKE ${this.param(value)}`;
      if (op === "eq") return `${ident(col)} = ${this.param(value)}`;
      throw new DbError(`Unsupported or() operator: ${op}`, "42601");
    });
    this.where.push(`(${parts.join(" OR ")})`);
    return this;
  }

  // ------------------------------------------------------------ shaping
  order(col: string, opts: { ascending?: boolean } = {}): this {
    this.ord = { col, asc: opts.ascending !== false };
    return this;
  }
  range(from: number, to: number): this { this.rng = [from, to]; return this; }
  limit(n: number): this { this.lim = n; return this; }
  maybeSingle(): Builder<any> { this.mode = "maybe"; return this; }
  single(): Builder<any> { this.mode = "single"; return this; }

  // ------------------------------------------------------------ execution
  then<R1 = DbResult<D>, R2 = never>(
    onfulfilled?: ((value: DbResult<D>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private async run(): Promise<DbResult<D>> {
    try {
      return await this.execute();
    } catch (err) {
      return { data: null as D, error: toDbError(err), count: null };
    }
  }

  private whereSql(): string {
    return this.where.length ? ` WHERE ${this.where.join(" AND ")}` : "";
  }

  private async execute(): Promise<DbResult<any>> {
    const t = ident(this.table);
    let count: number | null = null;
    let rows: Row[] = [];

    if (this.op === "select") {
      if (this.countExact) {
        const r = await this.pool.query(`SELECT count(*)::int AS n FROM ${t}${this.whereSql()}`, this.params);
        count = Number(r.rows[0]?.n ?? 0);
      }
      if (!this.head) {
        let sql = `SELECT ${columnList(this.columns)} FROM ${t}${this.whereSql()}`;
        if (this.ord) sql += ` ORDER BY ${ident(this.ord.col)} ${this.ord.asc ? "ASC" : "DESC"}`;
        if (this.rng) sql += ` LIMIT ${this.rng[1] - this.rng[0] + 1} OFFSET ${this.rng[0]}`;
        else if (this.lim !== null) sql += ` LIMIT ${Math.max(0, Math.floor(this.lim))}`;
        rows = (await this.pool.query(sql, this.params)).rows;
      }
    } else if (this.op === "insert" || this.op === "upsert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      if (list.length === 0) return { data: [], error: null, count: null };
      const cols = [...new Set(list.flatMap((r) => Object.keys(r).filter((k) => r[k] !== undefined)))];
      if (cols.length === 0) throw new DbError("Nothing to insert", "42601");
      const values = list
        .map((r) => `(${cols.map((c) => this.param(r[c])).join(", ")})`)
        .join(", ");
      let sql = `INSERT INTO ${t} (${cols.map(ident).join(", ")}) VALUES ${values}`;
      if (this.op === "upsert") {
        if (this.onConflict.length === 0) throw new DbError("upsert requires onConflict", "42601");
        const updates = cols
          .filter((c) => !this.onConflict.includes(c))
          .map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`);
        sql += ` ON CONFLICT (${this.onConflict.map(ident).join(", ")}) DO ${
          updates.length ? `UPDATE SET ${updates.join(", ")}` : "NOTHING"
        }`;
      }
      if (this.returning) sql += ` RETURNING ${columnList(this.returning)}`;
      rows = (await this.pool.query(sql, this.params)).rows;
    } else if (this.op === "update") {
      const patch = (this.payload ?? {}) as Row;
      const cols = Object.keys(patch).filter((k) => patch[k] !== undefined);
      if (cols.length === 0) throw new DbError("Nothing to update", "42601");
      // SET parameters must be numbered after the WHERE parameters already collected.
      const sets = cols.map((c) => `${ident(c)} = ${this.param(patch[c])}`).join(", ");
      let sql = `UPDATE ${t} SET ${sets}${this.whereSql()}`;
      if (this.returning) sql += ` RETURNING ${columnList(this.returning)}`;
      rows = (await this.pool.query(sql, this.params)).rows;
    } else if (this.op === "delete") {
      let sql = `DELETE FROM ${t}${this.whereSql()}`;
      if (this.returning) sql += ` RETURNING ${columnList(this.returning)}`;
      rows = (await this.pool.query(sql, this.params)).rows;
    }

    if (this.head) return { data: null, error: null, count };
    if (this.mode === "maybe") {
      if (rows.length > 1) throw new DbError("Multiple rows returned where at most one was expected", "PGRST116");
      return { data: rows[0] ?? null, error: null, count };
    }
    if (this.mode === "single") {
      if (rows.length !== 1) throw new DbError(`Expected exactly one row, got ${rows.length}`, "PGRST116");
      return { data: rows[0], error: null, count };
    }
    return { data: rows, error: null, count };
  }
}

export interface DbClient {
  from(table: string): Builder<any[]>;

  rpc(name: string, params?: Record<string, unknown>): PromiseLike<DbResult>;
  /** Run raw SQL (used for the idempotent schema migration). */
  exec(sql: string): Promise<void>;
  end(): Promise<void>;
}

export interface ClientOptions {
  /** Max pooled connections. The free AletCloud plan allows 10 in total. */
  max?: number;
  /** Force TLS (self-signed certificates accepted). */
  ssl?: boolean;
}

export function createClient(connectionString: string, opts: ClientOptions = {}): DbClient {
  const pool = new Pool({
    connectionString,
    max: opts.max ?? 5,
    ssl: opts.ssl ? { rejectUnauthorized: false } : undefined,
    idleTimeoutMillis: 30_000,
  });
  pool.on("error", (err) => console.error("pg pool error:", err.message));

  return {
    from: (table) => new Builder(pool, table),
    rpc(name, params = {}) {
      const run = async (): Promise<DbResult> => {
        try {
          const keys = Object.keys(params);
          const args = keys.map((k, i) => `${ident(k)} := $${i + 1}`).join(", ");
          const r = await pool.query(`SELECT * FROM ${ident(name)}(${args})`, keys.map((k) => toParam(params[k])));
          // A scalar function comes back as one row with one column named after the function.
          const scalar = r.fields.length === 1 && r.fields[0].name === name;
          return { data: scalar ? (r.rows[0]?.[name] ?? null) : r.rows, error: null, count: null };
        } catch (err) {
          return { data: null, error: toDbError(err), count: null };
        }
      };
      return { then: (ok, ko) => run().then(ok, ko) };
    },
    async exec(sql) {
      await pool.query(sql);
    },
    end: () => pool.end(),
  };
}
