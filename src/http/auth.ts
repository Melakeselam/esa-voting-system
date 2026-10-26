import { createHmac, timingSafeEqual } from "node:crypto";

export interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface VerifiedInitData {
  user: TgUser;
  authDate: number;
  startParam?: string;
}

/**
 * Validate Telegram Mini App `initData` (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
 *
 * data_check_string = all fields except `hash`, as "key=value", sorted, joined by "\n"
 * secret_key        = HMAC_SHA256(key = "WebAppData", message = bot_token)
 * hash              = hex(HMAC_SHA256(key = secret_key, message = data_check_string))
 *
 * Returns null when the signature is invalid or the data is older than maxAgeSec.
 */
export function verifyInitData(initData: string, botToken: string, maxAgeSec = 24 * 3600): VerifiedInitData | null {
  if (!initData || initData.length > 8192) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;

  const pairs: string[] = [];
  params.forEach((value, key) => {
    if (key !== "hash") pairs.push(`${key}=${value}`);
  });
  pairs.sort();

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = createHmac("sha256", secretKey).update(pairs.join("\n")).digest("hex");
  if (!timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(hash, "hex"))) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  if (Date.now() / 1000 - authDate > maxAgeSec) return null;

  let user: TgUser | null = null;
  try {
    user = JSON.parse(params.get("user") ?? "null") as TgUser | null;
  } catch {
    return null;
  }
  if (!user || typeof user.id !== "number") return null;

  return { user, authDate, startParam: params.get("start_param") ?? undefined };
}
