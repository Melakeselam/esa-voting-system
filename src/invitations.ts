import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { cap, wordsOf, type OrgWords } from "./services/orgs.js";
import type { Council } from "./types.js";

/**
 * Printable voting invitations: one A4 PDF per council, two invitation cards
 * per page (cut along the dashed line). Each card carries the council, the
 * delegate, the invitation code, the password, a QR code and the deep link
 * that opens the bot with the code pre-filled. English always; Amharic lines
 * are added when the Ethiopic font file is present.
 */

export interface InvitationRow {
  token_id: string;
  password: string;
  full_name: string | null;
  seat_no: number | null;
  phone?: string | null;
  vote_weight?: number; // votes this person casts (shares), shown when more than one
}

export interface InvitationPdfOptions {
  council: Pick<Council, "name" | "seats"> | null; // null: the organisation has no councils, members vote for themselves
  rows: InvitationRow[];
  botUsername: string;
  assemblyName?: string; // e.g. "General Assembly 2026" (overrides words.assembly)
  words?: OrgWords; // the organisation's name, office and terms (platform defaults when absent)
}

/** Deep link that opens the bot and hands it the invitation code. */
export function invitationLink(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=inv_${encodeURIComponent(token)}`;
}

// Noto Sans Ethiopic (static build) covers the Ethiopic block only, so Latin
// text is always set in Helvetica and the Ethiopic font is used per string.
const FONT_URL = new URL("../assets/fonts/NotoSansEthiopic-Regular.ttf", import.meta.url);
const ethiopicFontPath = (() => {
  try {
    const p = fileURLToPath(FONT_URL);
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
})();

export function ethiopicFontAvailable(): boolean {
  return ethiopicFontPath !== null;
}

const ETHIOPIC = /[ሀ-፿ᎀ-᎟ⶀ-⷟꬀-꬯]/;

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 36;
const CARDS_PER_PAGE = 2;

export async function invitationsPdf(opts: InvitationPdfOptions): Promise<Buffer> {
  const w = opts.words ?? wordsOf(null);
  const assembly = opts.assemblyName ?? w.assembly;
  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    info: { Title: `Voting invitations — ${opts.council?.name ?? (opts.words?.name ?? "members")}`, Author: `${w.name} — ${cap(w.office)}` },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const am = ethiopicFontPath !== null;
  if (am) doc.registerFont("Ethiopic", ethiopicFontPath!);
  /** Font for a string: Ethiopic when it contains Ethiopic letters (and the font exists), else Helvetica. */
  const fontFor = (text: string, bold = false): string =>
    am && ETHIOPIC.test(text) ? "Ethiopic" : bold ? "Helvetica-Bold" : "Helvetica";
  /** Split a string into runs of Ethiopic vs other script, so each run can use a font that has its glyphs. */
  const runs = (text: string): { text: string; ethiopic: boolean }[] => {
    const out: { text: string; ethiopic: boolean }[] = [];
    for (const ch of text) {
      const eth = ETHIOPIC.test(ch);
      const last = out[out.length - 1];
      // Spaces and punctuation stay with the current run.
      if (last && (last.ethiopic === eth || /[\s\d.,:;()«»—-]/.test(ch))) last.text += ch;
      else out.push({ text: ch, ethiopic: eth });
    }
    return out;
  };
  /** Write a paragraph at (x, y), switching fonts per script run, and return the y below it. */
  const para = (text: string, x: number, y: number, width: number, size: number, color: string, bold = false, extra: Record<string, unknown> = {}): number => {
    const parts = am ? runs(text) : [{ text, ethiopic: false }];
    doc.fillColor(color).fontSize(size);
    if (parts.length === 1) {
      doc.font(fontFor(text, bold));
      const h = doc.heightOfString(text, { width, ...extra });
      doc.text(text, x, y, { width, ...extra });
      return y + h;
    }
    parts.forEach((p, k) => {
      doc.font(p.ethiopic ? "Ethiopic" : bold ? "Helvetica-Bold" : "Helvetica");
      if (k === 0) doc.text(p.text, x, y, { width, continued: true, ...extra });
      else doc.text(p.text, { width, continued: k < parts.length - 1, ...extra });
    });
    return doc.y;
  };

  const qrs = await Promise.all(
    opts.rows.map((r) => QRCode.toBuffer(invitationLink(opts.botUsername, r.token_id), { type: "png", width: 360, margin: 1, errorCorrectionLevel: "M" })),
  );

  const cardH = (A4.height - 2 * MARGIN) / CARDS_PER_PAGE;
  const cardW = A4.width - 2 * MARGIN;
  const pad = 18;
  const innerW = cardW - 2 * pad;
  const qrSize = 132;
  const textW = innerW - qrSize - 16; // text column left of the QR

  opts.rows.forEach((row, i) => {
    const slot = i % CARDS_PER_PAGE;
    if (i > 0 && slot === 0) doc.addPage();
    const top = MARGIN + slot * cardH;
    const x = MARGIN + pad;

    // Frame + cut line
    doc.save();
    doc.roundedRect(MARGIN, top + 6, cardW, cardH - 12, 10).lineWidth(0.8).strokeColor("#9aa4ae").stroke();
    if (slot < CARDS_PER_PAGE - 1) {
      doc.moveTo(MARGIN - 10, top + cardH).lineTo(MARGIN + cardW + 10, top + cardH).dash(4, { space: 4 }).strokeColor("#b0b8c0").stroke().undash();
    }
    doc.restore();

    // QR block (right)
    const qrX = MARGIN + cardW - pad - qrSize;
    const qrY = top + pad + 4;
    const link = invitationLink(opts.botUsername, row.token_id);
    doc.image(qrs[i], qrX, qrY, { width: qrSize, height: qrSize });
    doc.link(qrX, qrY, qrSize, qrSize, link); // tapping the QR on a phone opens the bot too
    let qy = para("Scan or tap to open the voting bot", qrX - 12, qrY + qrSize + 4, qrSize + 24, 8, "#5a6470", false, { align: "center" });
    if (am) qy = para("ቦቱን ለመክፈት ይቃኙ ወይም ይንኩ", qrX - 12, qy + 1, qrSize + 24, 8.5, "#5a6470", false, { align: "center" });
    // Big tappable button for delegates who open the PDF on the phone they will vote with.
    const btnW = qrSize + 24;
    const btnH = am ? 34 : 24;
    const btnX = qrX - 12;
    const btnY = qy + 6;
    doc.save();
    doc.roundedRect(btnX, btnY, btnW, btnH, 7).fillColor("#2481cc").fill();
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(10).text("Tap here to register  ›", btnX, btnY + 6, { width: btnW, align: "center", lineBreak: false });
    if (am) doc.font("Ethiopic").fontSize(9).text("ለመመዝገብ እዚህ ይንኩ", btnX, btnY + 19, { width: btnW, align: "center", lineBreak: false });
    doc.restore();
    doc.link(btnX, btnY, btnW, btnH, link);

    // Header (left column)
    let y = top + pad + 6;
    y = para(w.name, x, y, textW, 14, "#0f0f0f", true) + 1;
    y = para(`${assembly} — Voting invitation`, x, y, textW, 10.5, "#5a6470") + 1;
    if (am && w.nameAm) y = para(`${w.nameAm}${w.assemblyAm ? ` ${w.assemblyAm}` : ""} — የድምፅ መስጫ ጥሪ`, x, y, textW, 10.5, "#5a6470") + 1;
    y += 8;

    // Council (when the organisation has them) + the person
    const council = opts.council;
    const seats = council?.seats;
    const delegate = row.full_name ? row.full_name : row.seat_no ? `${cap(w.voter.en)} ${row.seat_no}${seats ? ` of ${seats}` : ""}` : cap(w.voter.en);
    const labelW = 86; // room for longer terms ("Representative", "Constituency")
    if (council) {
      para(cap(w.group.en), x, y, labelW, 10, "#5a6470");
      y = para(council.name, x + labelW, y, textW - labelW, 11.5, "#0f0f0f", true) + 3;
    }
    para(cap(w.voter.en), x, y, labelW, 10, "#5a6470");
    y = para(row.full_name || !row.phone ? delegate : row.phone, x + labelW, y, textW - labelW, 11.5, "#0f0f0f", true) + 3;
    if (row.full_name && row.phone) {
      para("Phone", x, y, labelW, 10, "#5a6470");
      y = para(row.phone, x + labelW, y, textW - labelW, 11.5, "#0f0f0f", true) + 3;
    }
    if (!council && (row.vote_weight ?? 1) > 1) {
      // Members voting with several votes (e.g. shares) see how many on their invitation.
      para("Votes", x, y, labelW, 10, "#5a6470");
      y = para(String(row.vote_weight), x + labelW, y, textW - labelW, 11.5, "#0f0f0f", true) + 3;
    }
    y += 7;

    // Code + password boxes
    const boxW = (textW - 10) / 2;
    const boxH = 50;
    const boxes: [string, string, string][] = [
      ["Invitation code", "የጥሪ ኮድ", row.token_id],
      ["Password", "የይለፍ ቃል", row.password],
    ];
    boxes.forEach(([label, amLabel, value], k) => {
      const bx = x + k * (boxW + 10);
      doc.roundedRect(bx, y, boxW, boxH, 6).fillColor("#f0f2f5").fill();
      doc.fillColor("#5a6470").font("Helvetica").fontSize(7.5).text(label, bx + 8, y + 6, { lineBreak: false });
      if (am) doc.font("Ethiopic").fontSize(7.5).text(amLabel, bx + 8 + doc.widthOfString(label + "   "), y + 6, { lineBreak: false });
      doc.fillColor("#0f0f0f").font("Courier-Bold").fontSize(16).text(value, bx + 8, y + 22, { width: boxW - 16, lineBreak: false });
    });
    y += boxH + 12;

    // Steps (English, with Amharic under each when available)
    const steps: [string, string][] = [
      ["1. Scan the QR code or open the link below in Telegram.", "QR ኮዱን ይቃኙ ወይም ከታች ያለውን አገናኝ በቴሌግራም ይክፈቱ።"],
      ["2. Tap Start. The bot recognises your invitation code.", "Start ይንኩ። ቦቱ የጥሪ ኮድዎን ያውቀዋል።"],
      ["3. Enter the password above. You are then registered to vote.", "ከላይ ያለውን የይለፍ ቃል ያስገቡ። ከዚያ ድምፅ ለመስጠት ተመዝግበዋል።"],
    ];
    const stepsW = y < qrY + qrSize + 30 ? textW : innerW;
    for (const [en, amText] of steps) {
      y = para(en, x, y, stepsW, 9.5, "#0f0f0f") + 1;
      if (am) y = para(amText, x + 12, y, stepsW - 12, 9.5, "#5a6470") + 2;
    }
    y += 4;
    y = para(link, x, y, innerW, 8.5, "#2481cc", false, { link, underline: true }) + 8;
    y = para(`Keep this invitation private: anyone holding the code and password can vote in your place. Issued by the ${w.office} of ${w.name}.`, x, y, innerW, 8.5, "#8a3b3b") + 2;
    if (am) para(`ይህን ጥሪ በግል ያስቀምጡ፦ ኮዱንና የይለፍ ቃሉን የያዘ ማንኛውም ሰው በእርስዎ ምትክ ድምፅ መስጠት ይችላል።${w.officeAm ? ` በ${w.officeAm} የተሰጠ።` : ""}`, x, y, innerW, 8.5, "#8a3b3b");
  });

  if (opts.rows.length === 0) {
    doc.font("Helvetica").fontSize(12).text(`No invitations for ${opts.council?.name ?? "these members"}.`, MARGIN, MARGIN);
  }
  doc.end();
  return done;
}
