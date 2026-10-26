/**
 * Apply db/schema.sql to the database in DATABASE_URL (idempotent).
 * The server does this automatically at start-up unless AUTO_MIGRATE=0;
 * this script exists for running it by hand, e.g. against a local database.
 *
 *   npm run db:migrate
 */
import { ensureSchema, supabase } from "../src/db.js";
import { missingConfig } from "../src/config.js";

if (missingConfig.includes("DATABASE_URL")) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

try {
  await ensureSchema();
  console.log("Schema applied.");
} finally {
  await supabase.end();
}
