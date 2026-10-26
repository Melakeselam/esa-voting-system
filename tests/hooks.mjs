// Node module-loader hook: swap src/pgclient.ts (the PostgreSQL query builder)
// for the in-memory fake so the full application can be exercised without a
// database.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "./pgclient.js" || specifier.endsWith("/pgclient.js")) {
    return { url: new URL("./fake-supabase.mjs", import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
