/**
 * Generate voting credentials (token + password) for members from the command
 * line. The Mini App (Members → Generate credentials) does the same thing with
 * buttons and delivers the CSV to your Telegram chat.
 *
 * Usage:
 *   npm run gen:credentials -- --count 30
 *   npm run gen:credentials -- --names members.csv        (one "Full Name,Region" per line)
 *   npm run gen:credentials -- --count 30 --prefix ESA-2026
 *
 * The CSV with PLAINTEXT passwords is written to ./out/ — it is the ONLY
 * place plaintext passwords exist. Distribute it securely and delete it.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { credentialsCsv, generateCredentials, parsePeople, type Person } from "../src/services/credentials.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const prefix = arg("prefix") ?? "ESA-2026";
const namesFile = arg("names");

let people: Person[];
if (namesFile) {
  people = parsePeople(readFileSync(namesFile, "utf8"));
} else {
  const count = Number(arg("count") ?? 0);
  if (!Number.isInteger(count) || count <= 0) {
    console.error("Provide --count N or --names file.csv");
    process.exit(1);
  }
  people = Array.from({ length: count }, () => ({ name: null, region: null }));
}

console.log(`Generating ${people.length} credentials with prefix ${prefix}…`);
const rows = await generateCredentials(people, prefix);
for (const row of rows) console.log(`  ${row.token_id}  ${row.full_name ?? ""}`);

mkdirSync("out", { recursive: true });
const file = `out/credentials-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
writeFileSync(file, credentialsCsv(rows), "utf8");
console.log(`\n✅ Done. Plaintext credentials written to ${file}`);
console.log("⚠️  Distribute this file securely (one row per member) and DELETE it afterwards.");
console.log("    Only bcrypt hashes are stored in the database.");
