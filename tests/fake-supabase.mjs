/**
 * In-memory stand-in for src/pgclient.ts (a supabase-js-style query builder
 * over PostgreSQL), covering the subset this project uses, plus the two SQL
 * functions (cast_vote, tally_votes) re-implemented in JavaScript with the
 * same semantics.
 * Loaded through tests/hooks.mjs. The instance is exposed on
 * globalThis.__fakeSupabase so tests can inspect raw rows.
 */
import { randomUUID } from "node:crypto";

const DEFAULTS = {
  members: () => ({ id: randomUUID(), full_name: null, region: null, phone: null, council_id: null, seat_no: null, vote_weight: 1, telegram_user_id: null, registered_at: null, failed_attempts: 0, locked_until: null, is_active: true, created_at: now() }),
  resolutions: () => ({ id: randomUUID(), description: null, anonymous: true, quorum: null, eligible_count: null, activation_required: true, activation_code: null, awaiting_quorum_since: null, threshold: "simple", status: "draft", announce_chat_id: null, announce_thread_id: null, closes_at: null, opened_at: null, closed_at: null, created_at: now() }),
  ballots: () => ({ created_at: now() }),
  votes: () => ({ id: randomUUID(), member_id: null, weight: 1, created_at: now(), updated_at: now() }),
  audit_log: () => ({ details: null, created_at: now() }),
  app_settings: () => ({ updated_at: now() }),
  chat_topics: () => ({ thread_id: 0, name: null, chat_title: null, updated_at: now() }),
  admins: () => ({ name: null, added_by: null, created_at: now() }),
  councils: () => ({ id: randomUUID(), seats: 1, vote_weight: 1, created_at: now() }),
  group_people: () => ({ first_name: null, last_name: null, username: null, status: "member", source: null, added_by: null, first_seen_at: now(), last_seen_at: now() }),
  vote_activations: () => ({ activated_at: now() }),
};
const PRIMARY = {
  members: ["id"], resolutions: ["id"], ballots: ["resolution_id", "member_id"], votes: ["id"], audit_log: ["id"],
  app_settings: ["key"], chat_topics: ["chat_id", "thread_id"], admins: ["telegram_user_id"], councils: ["id"],
  group_people: ["chat_id", "user_id"],
  vote_activations: ["resolution_id", "member_id"],
};
const UNIQUE = {
  members: [["token_id"], ["telegram_user_id"]],
  resolutions: [["code"]],
  ballots: [["resolution_id", "member_id"]],
  votes: [["resolution_id", "member_id"]],
  app_settings: [["key"]],
  chat_topics: [["chat_id", "thread_id"]],
  admins: [["telegram_user_id"]],
  councils: [["name"], ["code"]],
};

function now() { return new Date().toISOString(); }
function same(a, b) { return a === b || (a != null && b != null && String(a) === String(b)); }

class FakeClient {
  constructor() {
    this.tables = Object.fromEntries(Object.keys(DEFAULTS).map((t) => [t, []]));
    this.seq = 0;
    this.missing = new Set(); // tables pretending not to exist (to test setup diagnostics)
  }
  from(table) { return new Builder(this, table); }
  rpc(name, args) {
    const run = () => Promise.resolve().then(() => this._rpc(name, args));
    return { then: (ok, ko) => run().then(ok, ko) };
  }
  _rpc(name, a) {
    if (name === "cast_vote") return { data: this._castVote(a.p_resolution_id, a.p_member_id, a.p_choice), error: null };
    if (name === "tally_votes") {
      const counts = new Map();
      for (const v of this.tables.votes) if (same(v.resolution_id, a.p_resolution_id)) counts.set(v.choice_index, (counts.get(v.choice_index) ?? 0) + (v.weight ?? 1));
      return { data: [...counts].map(([choice_index, votes]) => ({ choice_index, votes })).sort((x, y) => x.choice_index - y.choice_index), error: null };
    }
    return { data: null, error: { message: `function ${name} does not exist`, code: "42883" } };
  }
  _castVote(resId, memberId, choice) {
    const res = this.tables.resolutions.find((r) => r.id === resId);
    if (!res) return "not_found";
    if (res.status !== "open") return "not_open";
    if (choice < 0 || choice >= res.options.length) return "bad_choice";
    const weight = this.tables.members.find((m) => m.id === memberId)?.vote_weight ?? 1;
    const hasBallot = this.tables.ballots.some((b) => b.resolution_id === resId && b.member_id === memberId);
    if (hasBallot) {
      if (res.anonymous) return "already_voted";
      const v = this.tables.votes.find((x) => x.resolution_id === resId && x.member_id === memberId);
      if (v) { v.choice_index = choice; v.weight = weight; v.updated_at = now(); }
      return "changed";
    }
    this._insert("ballots", { resolution_id: resId, member_id: memberId });
    this._insert("votes", { resolution_id: resId, member_id: res.anonymous ? null : memberId, choice_index: choice, weight });
    return "ok";
  }
  _insert(table, row) {
    const full = { ...DEFAULTS[table](), ...row, _seq: ++this.seq };
    if (table === "audit_log") full.id = this.seq;
    for (const cols of UNIQUE[table] ?? []) {
      if (cols.some((c) => full[c] == null)) continue;
      if (this.tables[table].some((r) => cols.every((c) => same(r[c], full[c])))) {
        return { error: { message: `duplicate key value violates unique constraint (${cols.join(",")})`, code: "23505" } };
      }
    }
    this.tables[table].push(full);
    return { row: full };
  }
}

function project(row, cols) {
  if (!row) return row;
  const clean = Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith("_")));
  if (!cols || cols.trim() === "*") return clean;
  const out = {};
  for (const c of cols.split(",").map((s) => s.trim()).filter(Boolean)) out[c] = clean[c] ?? null;
  return out;
}

class Builder {
  constructor(client, table) {
    this.c = client; this.t = table; this.op = "select"; this.filters = []; this.cols = "*";
    this.count = null; this.head = false; this.ord = null; this.rng = null; this.lim = null;
    this.mode = "many"; this.payload = null; this.returning = false; this.onConflict = null;
  }
  select(cols = "*", opts = {}) {
    if (this.op === "select") { this.cols = cols; this.count = opts.count ?? null; this.head = Boolean(opts.head); }
    else { this.returning = true; this.cols = cols; }
    return this;
  }
  insert(rows) { this.op = "insert"; this.payload = rows; return this; }
  update(patch) { this.op = "update"; this.payload = patch; return this; }
  delete() { this.op = "delete"; return this; }
  upsert(rows, opts = {}) { this.op = "upsert"; this.payload = rows; this.onConflict = (opts.onConflict ?? "").split(",").map((s) => s.trim()).filter(Boolean); return this; }
  eq(c, v) { this.filters.push((r) => same(r[c], v)); return this; }
  neq(c, v) { this.filters.push((r) => !same(r[c], v)); return this; }
  gt(c, v) { this.filters.push((r) => r[c] != null && r[c] > v); return this; }
  gte(c, v) { this.filters.push((r) => r[c] != null && r[c] >= v); return this; }
  lt(c, v) { this.filters.push((r) => r[c] != null && r[c] < v); return this; }
  lte(c, v) { this.filters.push((r) => r[c] != null && r[c] <= v); return this; }
  is(c, v) { this.filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
  not(c, op, v) {
    if (op === "is" && v === null) this.filters.push((r) => r[c] != null);
    else if (op === "eq") this.filters.push((r) => !same(r[c], v));
    else throw new Error(`fake: unsupported not(${op})`);
    return this;
  }
  ilike(c, pattern) { const re = likeRegex(pattern); this.filters.push((r) => re.test(String(r[c] ?? ""))); return this; }
  or(expr) {
    const parts = expr.split(",").map((p) => { const [col, op, ...rest] = p.split("."); return { col, op, val: rest.join(".") }; });
    this.filters.push((r) => parts.some(({ col, op, val }) => (op === "ilike" ? likeRegex(val).test(String(r[col] ?? "")) : op === "eq" ? same(r[col], val) : false)));
    return this;
  }
  order(c, opts = {}) { this.ord = { c, asc: opts.ascending !== false }; return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  limit(n) { this.lim = n; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  single() { this.mode = "single"; return this; }
  then(ok, ko) { return Promise.resolve().then(() => this._run()).then(ok, ko); }

  _run() {
    const c = this.c;
    if (!(this.t in c.tables) || c.missing.has(this.t)) return { data: null, error: { message: `relation "${this.t}" does not exist`, code: "42P01" }, count: null };
    const rows = c.tables[this.t];
    const match = (r) => this.filters.every((f) => f(r));
    switch (this.op) {
      case "select": {
        let out = rows.filter(match);
        const count = this.count ? out.length : null;
        if (this.ord) {
          const { c: col, asc } = this.ord;
          out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : a._seq - b._seq) * (asc ? 1 : -1));
        }
        if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
        if (this.lim != null) out = out.slice(0, this.lim);
        if (this.head) return { data: null, error: null, count };
        return this._shape(out.map((r) => project(r, this.cols)), count);
      }
      case "insert": {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload];
        const inserted = [];
        for (const row of list) {
          const r = c._insert(this.t, row);
          if (r.error) return { data: null, error: r.error, count: null };
          inserted.push(r.row);
        }
        return this._shape(this.returning ? inserted.map((r) => project(r, this.cols)) : null, null);
      }
      case "update": {
        const hit = rows.filter(match);
        for (const r of hit) {
          const next = { ...r, ...this.payload };
          for (const cols of UNIQUE[this.t] ?? []) {
            if (cols.some((k) => next[k] == null)) continue;
            if (rows.some((o) => o !== r && cols.every((k) => same(o[k], next[k])))) return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" }, count: null };
          }
          Object.assign(r, this.payload);
        }
        return this._shape(this.returning ? hit.map((r) => project(r, this.cols)) : null, null);
      }
      case "delete": {
        const hit = rows.filter(match);
        c.tables[this.t] = rows.filter((r) => !match(r));
        if (this.t === "councils") for (const r of hit) for (const m of c.tables.members) if (m.council_id === r.id) m.council_id = null;
        if (this.t === "resolutions") for (const r of hit) { c.tables.ballots = c.tables.ballots.filter((b) => b.resolution_id !== r.id); c.tables.votes = c.tables.votes.filter((v) => v.resolution_id !== r.id); }
        return this._shape(this.returning ? hit.map((r) => project(r, this.cols)) : null, null);
      }
      case "upsert": {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload];
        const keys = this.onConflict.length ? this.onConflict : PRIMARY[this.t];
        const out = [];
        for (const row of list) {
          const existing = rows.find((r) => keys.every((k) => same(r[k], row[k])));
          if (existing) { Object.assign(existing, row); out.push(existing); }
          else { const r = c._insert(this.t, row); if (r.error) return { data: null, error: r.error, count: null }; out.push(r.row); }
        }
        return this._shape(this.returning ? out.map((r) => project(r, this.cols)) : null, null);
      }
    }
    throw new Error("fake: unknown op");
  }
  _shape(data, count) {
    if (this.mode === "maybe") return { data: data?.[0] ?? null, error: data && data.length > 1 ? { message: "multiple rows", code: "PGRST116" } : null, count };
    if (this.mode === "single") return data && data.length === 1 ? { data: data[0], error: null, count } : { data: null, error: { message: "expected a single row", code: "PGRST116" }, count };
    return { data, error: null, count };
  }
}

function likeRegex(pattern) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

export function createClient() {
  const client = new FakeClient();
  globalThis.__fakeSupabase = client;
  return client;
}
