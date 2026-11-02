import { Composer, InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import { config } from "../config.js";
import { confirmLogin } from "../services/billing.js";

/**
 * The bot's part of the business pages (src/http/biz-api.ts):
 *   /start weblogin_<code>  the page's "Sign in with Telegram" link — confirms who is signing in
 *   /start biz              a way to the business page (create your own organisation)
 * Runs before the organisation middleware: none of this belongs to an organisation.
 */
export const bizComposer = new Composer<Context>();

const pm = bizComposer.chatType("private");

function businessPage(): string | null {
  return config.businessPageUrl ?? (config.publicUrl ? `${config.publicUrl}/business/` : null);
}

pm.command("start", async (ctx, next) => {
  const payload = typeof ctx.match === "string" ? ctx.match.trim() : "";
  if (payload.startsWith("weblogin_")) {
    const ok = await confirmLogin(payload.slice("weblogin_".length), ctx.from);
    await ctx.reply(
      ok
        ? "✅ You are signed in on the Kene Voting business page. Go back to the page — it continues by itself.\n\n✅ በ Kene Voting የንግድ ገጽ ገብተዋል። ወደ ገጹ ይመለሱ — በራሱ ይቀጥላል።"
        : "⌛ This sign-in link has expired or was already used. Tap “Sign in with Telegram” on the page again.\n\n⌛ ይህ የመግቢያ ሊንክ ጊዜው አልፏል ወይም ተጠቅሞበታል። በገጹ ላይ እንደገና «በቴሌግራም ይግቡ» ይንኩ።",
    );
    return;
  }
  if (payload === "biz") {
    const url = businessPage();
    await ctx.reply(
      "🚀 Run your own assembly vote: create an organisation, invite your members and vote in Telegram.\n\n🚀 የራስዎን የጉባኤ ድምፅ ያካሂዱ፦ ድርጅት ይፍጠሩ፣ አባላትዎን ይጋብዙ፣ በቴሌግራም ድምፅ ይስጡ።",
      url ? { reply_markup: new InlineKeyboard().url("🚀 Create an organisation", url) } : {},
    );
    return;
  }
  await next();
});
