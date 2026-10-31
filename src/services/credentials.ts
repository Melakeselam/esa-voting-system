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
  vote_weight?: number;
  phone?: string | null;
}

export interface CredentialRow {
  token_id: string;
  password: string;
  full_name: string | null;
  region: string | null;
  seat_no?: number | null;
  phone?: string | null;
  vote_weight?: number;
}

/** Country code used for local numbers (0911…, 911…). Ethiopia by default; DEFAULT_PHONE_COUNTRY_CODE overrides. */
const COUNTRY = (process.env.DEFAULT_PHONE_COUNTRY_CODE ?? "251").replace(/\D/g, "") || "251";

/**
 * A phone number in international form (+2519…), or null when `raw` is not a
 * phone number. Accepts spaces, dashes, dots and brackets; local numbers
 * starting with 0 (or 9-digit mobile numbers) get the default country code.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s || !/^[+\d\s\-().]+$/.test(s)) return null;
  let digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = COUNTRY + digits.slice(1);
  else if (digits.length === 9 && COUNTRY === "251") digits = COUNTRY + digits; // 911 234 567
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

/**
 * Create members with fresh token + password, storing only the bcrypt hash.
 * Returns the plaintext rows — the ONLY place the passwords exist. Callers
 * must hand them to the National Office securely and never log them.
 */
export async function generateCredentials(people: Person[], prefix = "KVS-2026"): Promise<CredentialRow[]> {
  const cleanPrefix = prefix.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "") || "KVS";
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
        vote_weight: person.vote_weight ?? 1,
        phone: person.phone ?? null,
      });
      if (!error) {
        rows.push({ token_id: token, password, full_name: person.name, region: person.region, seat_no: person.seat_no ?? null, phone: person.phone ?? null, vote_weight: person.vote_weight ?? 1 });
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
    "token_id,password,full_name,region,phone",
    ...rows.map((r) => [r.token_id, r.password, esc(r.full_name), esc(r.region), esc(r.phone ?? null)].join(",")),
  ].join("\n");
}
