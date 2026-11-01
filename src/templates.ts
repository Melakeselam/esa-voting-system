import { cap, type OrgWords } from "./services/orgs.js";
import { xlsx, type SheetSpec } from "./xlsx.js";

/**
 * Fill-in spreadsheets for the Mini App's uploads, in the organisation's own
 * words. The first sheet is the one the app reads; its header row names the
 * columns the importers recognise. The second sheet explains and gives
 * examples (it is never read, so examples there are never imported).
 */
export type TemplateKind = "councils" | "delegates" | "members";
export const TEMPLATE_KINDS: TemplateKind[] = ["councils", "delegates", "members"];

export function templateFile(kind: TemplateKind, w: OrgWords): { name: string; data: Buffer } {
  const G = cap(w.group.en);
  const V = cap(w.voter.en);
  const slug = w.shortCode.toLowerCase();
  let fill: SheetSpec;
  let help: string[][];
  if (kind === "councils") {
    fill = {
      name: `${cap(w.group.en_pl)} and ${w.voter.en_pl}`.slice(0, 31),
      rows: [[G, "Name", "Phone", "Seats", "Votes each"]],
      widths: [30, 28, 18, 10, 12],
      textColumns: [2],
      boldFirstRow: true,
    };
    help = [
      ["How to fill this template"],
      [""],
      [`Fill the first sheet. Keep its header row. Then upload the file in the app: Members › ＋ Invitations › Import ${w.group.en_pl} from Excel / CSV.`],
      [""],
      [`${G}: the ${w.group.en} the ${w.voter.en} comes from. Required on every row.`],
      [`Name / Phone: the ${w.voter.en}. A name, a phone number, or both. Local numbers (09…) are stored as +251…`],
      [`Seats: the number of voting ${w.voter.en_pl} of the ${w.group.en}. No more invitations than this can ever be issued for it.`],
      [`Votes each: votes per ${w.voter.en} (vote weight). Leave empty for 1.`],
      [""],
      ["Two ways to fill it:"],
      [`1. Named: one row per ${w.voter.en} (${w.group.en} + name and/or phone). Give the seats on one of the ${w.group.en}'s rows, or leave it empty to use the number of rows.`],
      [`2. Anonymous: one row per ${w.group.en} with only the ${w.group.en} and its seats. That many anonymous invitations are issued; the ${w.group.en} hands them to its ${w.voter.en_pl}.`],
      [""],
      ["Example"],
      [G, "Name", "Phone", "Seats", "Votes each"],
      ["Addis Ababa", "Abebe Kebede", "0911234567", "3", ""],
      ["Addis Ababa", "Sara Tesfaye", "", "", ""],
      ["Addis Ababa", "", "+251922345678", "", ""],
      ["Oromia", "", "", "5", "2"],
      [""],
      [`Addis Ababa: 3 seats, 3 named invitations. Oromia: 5 anonymous invitations, 2 votes each.`],
    ];
  } else if (kind === "delegates") {
    fill = { name: cap(w.voter.en_pl).slice(0, 31), rows: [["Name", "Phone"]], widths: [30, 18], textColumns: [1], boldFirstRow: true };
    help = [
      ["How to fill this template"],
      [""],
      [`One row per ${w.voter.en}: a name, a phone number, or both. Keep the header row.`],
      [`Upload it in the app: open the ${w.group.en} › Add ${w.voter.en_pl}. Only as many invitations as the ${w.group.en} has free seats can be issued.`],
      ["Local numbers (09…) are stored as +251…"],
      [""],
      ["Example"],
      ["Name", "Phone"],
      ["Abebe Kebede", "0911234567"],
      ["Sara Tesfaye", ""],
      ["", "+251922345678"],
    ];
  } else {
    fill = { name: cap(w.voter.en_pl).slice(0, 31), rows: [["Name", "Phone", "Votes"]], widths: [30, 18, 10], textColumns: [1], boldFirstRow: true };
    help = [
      ["How to fill this template"],
      [""],
      [`One row per ${w.voter.en}: a name, a phone number, or both. Keep the header row.`],
      [`Votes: how many votes the ${w.voter.en} casts (for example shares). Leave empty for 1.`],
      [`Upload it in the app: Members › ＋ Add ${w.voter.en_pl}.`],
      ["Local numbers (09…) are stored as +251…"],
      [""],
      ["Example"],
      ["Name", "Phone", "Votes"],
      ["Abebe Kebede", "0911234567", "250"],
      ["Sara Tesfaye", "", "120"],
      ["", "+251922345678", ""],
    ];
  }
  const data = xlsx([fill, { name: "How to fill", rows: help, widths: [30, 28, 18, 10, 12] }]);
  const what = kind === "councils" ? `${w.group.en_pl}-and-${w.voter.en_pl}` : kind === "delegates" ? `${w.group.en}-${w.voter.en_pl}` : w.voter.en_pl;
  return { name: `${slug}-${what.replace(/\s+/g, "-")}-template.xlsx`, data };
}
