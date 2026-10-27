import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { supabase } from "../db.js";

// Unambiguous characters only (no 0/O, 1/I/L) — these get typed by hand.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomString(length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

export interface Person {
  name: string | null;
  region: string | null;
  council_id?: string | null;
  seat_no?: number | null;
}

export interface CredentialRow {
  token_id: string;
  password: string;
  full_name: string | null;
  region: string | null;
  seat_no?: number | null;
}

/**
 * Create members with fresh token + password, storing only the bcrypt hash.
 * Returns the plaintext rows — the ONLY place the passwords exist. Callers
 * must hand them to the National Office securely and never log them.
 */
export async function generateCredentials(people: Person[], prefix = "ESA-2026"): Promise<CredentialRow[]> {
  const cleanPrefix = prefix.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "") || "ESA";
  const rows: CredentialRow[] = [];
  for (const person of people) {
    const password = randomString(10);
    const hash = await bcrypt.hash(password, 10);
    // Retry on the (very unlikely) token collision.
    for (let attempt = 0; ; attempt++) {
      const token = `${cleanPrefix}-${randomString(5)}`;
      const { error } = await supabase.from("members").insert({
        token_id: token,
        password_hash: hash,
        full_name: person.name,
        region: person.region,
        council_id: person.council_id ?? null,
        seat_no: person.seat_no ?? null,
      });
      if (!error) {
        rows.push({ token_id: token, password, full_name: person.name, region: person.region, seat_no: person.seat_no ?? null });
        break;
      }
      if (error.code !== "23505" || attempt >= 3) throw error;
    }
  }
  return rows;
}

/** Parse "Full Name, Region" lines (region optional). Blank lines are skipped. */
export function parsePeople(text: string): Person[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line) => {
      const [name, region] = line.split(",").map((s) => s.trim());
      return { name: name || null, region: region || null };
    });
}

export function credentialsCsv(rows: CredentialRow[]): string {
  const esc = (v: string | null): string => {
    const s = v ?? "";
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    "token_id,password,full_name,region",
    ...rows.map((r) => [r.token_id, r.password, esc(r.full_name), esc(r.region)].join(",")),
  ].join("\n");
}
