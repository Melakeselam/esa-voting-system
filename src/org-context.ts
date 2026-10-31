import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The organisation (assembly) the current request or bot update belongs to.
 * Kene Voting System is one bot and one database serving several
 * organisations; every query on organisation data is scoped to this value by
 * the database layer (src/db.ts). It is set once per HTTP request
 * (http/app-api.ts) and once per Telegram update (bot/org-middleware.ts), and
 * propagates through every await inside.
 */
const store = new AsyncLocalStorage<{ orgId: string | null }>();

export function withOrg<T>(orgId: string | null, fn: () => T): T {
  return store.run({ orgId }, fn);
}

export function currentOrgId(): string | null {
  return store.getStore()?.orgId ?? null;
}

export class NoOrgError extends Error {
  constructor(what: string) {
    super(`No organisation selected (${what}).`);
    this.name = "NoOrgError";
  }
}

export function requireOrgId(what = "organisation data"): string {
  const id = currentOrgId();
  if (!id) throw new NoOrgError(what);
  return id;
}
