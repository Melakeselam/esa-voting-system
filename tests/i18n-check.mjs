// Checks that every string app.js passes to t() has an Amharic translation with the same
// {placeholders}, and that help.js has the same number of sections per role in both languages.
// Run: node tests/i18n-check.mjs   (also part of `npm run test:mock`)
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../public/app/", import.meta.url);
const src = readFileSync(new URL("app.js", root), "utf8");

// Load i18n.js and help.js in a bare sandbox (they only touch window + localStorage).
const sandbox = { window: {}, localStorage: { getItem: () => null, setItem() {} }, navigator: { language: "en" } };
sandbox.window.localStorage = sandbox.localStorage;
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL("i18n.js", root), "utf8"), sandbox);
vm.runInContext(readFileSync(new URL("help.js", root), "utf8"), sandbox);
const { I18N, HELP } = sandbox.window;

// Keys used by app.js: t("…"), plural(n, "word") → word + words, and label tables passed through t().
const keys = new Set();
const re = /\bt\((["'])((?:\\.|(?!\1).)*)\1/g;
let m;
while ((m = re.exec(src))) keys.add(m[2].replace(/\\n/g, "\n").replace(/\\'/g, "'").replace(/\\"/g, '"'));
const pre = /plural\([^,]+,\s*"([a-z]+)"\)/g;
while ((m = pre.exec(src))) { keys.add(m[1]); keys.add(m[1] + "s"); }
for (const k of ["Home", "Resolutions", "Members", "Setup", "Vote", "Results", "Me", "All", "Draft", "Open", "Closed", "Registered", "Not registered", "Locked", "Deactivated"]) keys.add(k);

let failed = 0;
const placeholders = (s) => (s.match(/\{[a-z]+\}/g) || []).sort().join(",");
const am = I18N.dictionary("am");
const missing = [...keys].filter((k) => !(k in am));
const unused = Object.keys(am).filter((k) => !keys.has(k));
const badPh = [...keys].filter((k) => k in am && placeholders(k) !== placeholders(am[k]));
const empty = [...keys].filter((k) => k in am && !String(am[k]).trim());

function report(name, list) {
  if (list.length) { failed++; console.log(`FAIL ${name} (${list.length}):\n  ` + list.map((k) => JSON.stringify(k)).join("\n  ")); }
  else console.log(`ok   ${name}`);
}
report("every app.js string has an Amharic entry", missing);
report("placeholders match between English and Amharic", badPh);
report("no empty Amharic translations", empty);
if (unused.length) console.log(`note ${unused.length} dictionary entries are not used by app.js: ` + unused.map((k) => JSON.stringify(k)).join(", "));

// t() behaviour
I18N.setLang("am");
const sample = I18N.t("Quorum {n}%", { n: 7 });
if (!sample.includes("7") || sample === "Quorum {n}%") { failed++; console.log("FAIL t() does not translate + interpolate in Amharic: " + sample); } else console.log("ok   t() translates and interpolates (" + sample + ")");
I18N.setLang("en");
if (I18N.t("Quorum {n}%", { n: 7 }) !== "Quorum 7%") { failed++; console.log("FAIL t() English fallback"); } else console.log("ok   t() English fallback");
if (I18N.t("Not in the dictionary at all") !== "Not in the dictionary at all") { failed++; console.log("FAIL t() unknown key fallback"); } else console.log("ok   t() returns the key when there is no translation");

// Help content parity
for (const role of ["admin", "member", "guest"]) {
  const en = HELP.sections(role, "en"), amS = HELP.sections(role, "am");
  const same = en.length === amS.length && en.every((s, i) => JSON.stringify(s.body).length > 0 && amS[i].body.length === s.body.length);
  if (!same) { failed++; console.log(`FAIL help sections differ between languages for role ${role}`); } else console.log(`ok   help: ${en.length} sections for ${role}, same shape in both languages`);
}

console.log(`\ni18n check: ${failed ? failed + " problem(s)" : "all good"} — ${keys.size} strings, ${Object.keys(am).length} Amharic entries`);
process.exit(failed ? 1 : 0);
