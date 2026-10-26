import type { IncomingMessage, ServerResponse } from "node:http";

/** Error with an HTTP status; the message is safe to show to the caller. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function text(res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

/**
 * Read a JSON request body. Serverless platforms (Vercel) may have parsed the
 * body already and exposed it as req.body; otherwise the stream is read.
 */
export async function readJsonBody(req: IncomingMessage, limitBytes = 1_000_000): Promise<unknown> {
  const pre = (req as IncomingMessage & { body?: unknown }).body;
  if (pre !== undefined) {
    if (Buffer.isBuffer(pre)) return pre.length ? parse(pre.toString("utf8")) : null;
    if (typeof pre === "string") return pre.trim() ? parse(pre) : null;
    return pre;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > limitBytes) throw new HttpError(413, "Request body too large");
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? parse(raw) : null;
}

function parse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Malformed JSON body");
  }
}

// ---- small validators -----------------------------------------------------

export function asObject(v: unknown): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, "Expected a JSON object");
  return v as Record<string, unknown>;
}

export function str(v: unknown, field: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string {
  if (v === undefined || v === null || v === "") {
    if (opts.optional) return "";
    throw new HttpError(400, `${field} is required`);
  }
  if (typeof v !== "string") throw new HttpError(400, `${field} must be text`);
  const s = v.trim();
  if (opts.min !== undefined && s.length < opts.min) throw new HttpError(400, `${field} is too short`);
  if (opts.max !== undefined && s.length > opts.max) throw new HttpError(400, `${field} is too long (max ${opts.max})`);
  return s;
}

export function int(v: unknown, field: string, opts: { min?: number; max?: number; optional?: boolean } = {}): number | null {
  if (v === undefined || v === null || v === "") {
    if (opts.optional) return null;
    throw new HttpError(400, `${field} is required`);
  }
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n)) throw new HttpError(400, `${field} must be a whole number`);
  if (opts.min !== undefined && n < opts.min) throw new HttpError(400, `${field} must be at least ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw new HttpError(400, `${field} must be at most ${opts.max}`);
  return n;
}

export function bool(v: unknown, field: string, fallback: boolean): boolean {
  if (v === undefined || v === null) return fallback;
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "on" || v === 1) return true;
  if (v === "false" || v === "off" || v === 0) return false;
  throw new HttpError(400, `${field} must be true or false`);
}
