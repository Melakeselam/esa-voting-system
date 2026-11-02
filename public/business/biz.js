/* Kene Voting — business pages: sign up with Telegram, create an organisation,
   buy a plan (bank / mobile-money transfer + receipt), share the link; and the
   platform administrators' console (payments, organisations, plans, accounts).
   Talks to /api/biz on this server, or on window.KV_API_BASE when the pages are
   hosted on another site (the company website). */
(function () {
  "use strict";

  var API = (window.KV_API_BASE || "").replace(/\/$/, "");
  var tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData ? window.Telegram.WebApp : null;
  var main = document.getElementById("main");
  var nav = document.getElementById("nav");

  // ------------------------------------------------------------- storage (wrapped: private windows may refuse it)
  function load(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function save(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { /* ignore */ } }

  // A share link (?ref=CODE) is remembered until the person signs up.
  (function () {
    var m = /[?&]ref=([A-Za-z0-9]{4,16})/.exec(location.search);
    if (m) save("kvb_ref", m[1].toUpperCase());
  })();

  // ------------------------------------------------------------- language
  var lang = load("kvb_lang") || ((navigator.language || "").indexOf("am") === 0 ? "am" : "en");
  var AM = {
    "Sign in": "ይግቡ",
    "Sign out": "ውጣ",
    "Console": "ኮንሶል",
    "My organisations": "ድርጅቶቼ",
    "Run your association's general assembly votes on Telegram": "የማኅበርዎን የጠቅላላ ጉባኤ ድምፆች በቴሌግራም ያካሂዱ",
    "Members register with an invitation, vote from their phones with secret or open ballots, move and second motions, and you get quorum, results and the assembly report — all inside Telegram.": "አባላት በግብዣ ይመዘገባሉ፣ በስልካቸው በሚስጥር ወይም በግልጽ ድምፅ ይሰጣሉ፣ ሀሳብ ያቀርባሉ ይደግፋሉም፤ እርስዎም ምልዓተ ጉባኤ፣ ውጤቶችና የጉባኤ ሪፖርት ያገኛሉ — ሁሉም በቴሌግራም ውስጥ።",
    "Create your organisation": "ድርጅትዎን ይፍጠሩ",
    "See the plans": "ዕቅዶቹን ይመልከቱ",
    "How it works": "እንዴት ይሠራል",
    "Sign in with Telegram and create your organisation. You become its administrator.": "በቴሌግራም ገብተው ድርጅትዎን ይፍጠሩ። አስተዳዳሪው እርስዎ ይሆናሉ።",
    "Add the bot to your Telegram group (with Topics) and set up your councils or members. Try everything with up to {n} members for free.": "ቦቱን ወደ ቴሌግራም ቡድንዎ (ርዕሶች ያሉት) ያክሉና ምክር ቤቶችዎን ወይም አባላትዎን ያዘጋጁ። እስከ {n} አባላት ድረስ ሁሉንም በነጻ ይሞክሩ።",
    "Buy a plan by bank or mobile-money transfer, send the receipt, and run your assembly.": "በባንክ ወይም በሞባይል ገንዘብ ዝውውር ዕቅድ ይግዙ፣ ደረሰኙን ይላኩ፣ ጉባኤዎንም ያካሂዱ።",
    "Plans": "ዕቅዶች",
    "Prices in": "ዋጋዎች በ",
    "{n} days": "{n} ቀናት",
    "up to {n} members": "እስከ {n} አባላት",
    "no member limit": "የአባላት ገደብ የለም",
    "No plans are on offer yet.": "እስካሁን የቀረበ ዕቅድ የለም።",
    "Sign in with Telegram": "በቴሌግራም ይግቡ",
    "Tap the button: Telegram opens the Kene Voting bot. Tap Start there, then come back to this page — it continues by itself.": "አዝራሩን ይንኩ፦ ቴሌግራም የ Kene Voting ቦትን ይከፍታል። እዚያ Start ይንኩ፣ ከዚያ ወደዚህ ገጽ ይመለሱ — በራሱ ይቀጥላል።",
    "Open Telegram": "ቴሌግራም ክፈት",
    "Waiting for Telegram…": "ቴሌግራምን እየጠበቀ ነው…",
    "The link expired. Try again.": "ሊንኩ ጊዜው አልፏል። እንደገና ይሞክሩ።",
    "Try again": "እንደገና ይሞክሩ",
    "Signed in": "ገብተዋል",
    "Welcome, {name}": "እንኳን ደህና መጡ፣ {name}",
    "You have no organisation yet.": "እስካሁን ድርጅት የለዎትም።",
    "＋ Create an organisation": "＋ ድርጅት ይፍጠሩ",
    "Share Kene Voting": "Kene Votingን ያጋሩ",
    "Know an association that votes? Send them your link — they can create their own organisation.": "ድምፅ የሚሰጥ ማኅበር ያውቃሉ? ሊንክዎን ይላኩላቸው — የራሳቸውን ድርጅት መፍጠር ይችላሉ።",
    "Copy": "ቅዳ",
    "Copied": "ተቀድቷል",
    "Share in Telegram": "በቴሌግራም አጋራ",
    "New organisation": "አዲስ ድርጅት",
    "Organisation name": "የድርጅቱ ስም",
    "Name in Amharic (optional)": "ስም በአማርኛ (አማራጭ)",
    "Short code": "አጭር ኮድ",
    "2–8 letters; invitation codes start with it (for example AEA-K7M2P).": "2–8 ፊደላት፤ የግብዣ ኮዶች በእሱ ይጀምራሉ (ለምሳሌ AEA-K7M2P)።",
    "How do members vote?": "አባላት እንዴት ድምፅ ይሰጣሉ?",
    "Through councils (chapters, regions) that send delegates": "ተወካዮችን በሚልኩ ምክር ቤቶች (ቅርንጫፎች፣ ክልሎች) በኩል",
    "Directly — every member votes for themselves": "በቀጥታ — እያንዳንዱ አባል ለራሱ ድምፅ ይሰጣል",
    "Assembly (optional)": "ጉባኤ (አማራጭ)",
    "Office that issues invitations (optional)": "ግብዣዎችን የሚሰጥ ጽሕፈት ቤት (አማራጭ)",
    "Create": "ፍጠር",
    "Back": "ተመለስ",
    "Organisation created": "ድርጅቱ ተፈጥሯል",
    "Next steps": "ቀጣይ ደረጃዎች",
    "Open the app": "መተግበሪያውን ክፈት",
    "Add the bot to your group": "ቦቱን ወደ ቡድንዎ ያክሉ",
    "Create a Telegram group with Topics switched on, then add the bot as administrator with this link.": "ርዕሶች (Topics) የበራ የቴሌግራም ቡድን ይፍጠሩ፣ ከዚያ በዚህ ሊንክ ቦቱን አስተዳዳሪ አድርገው ያክሉ።",
    "In the app: Members → add councils or members and issue invitations.": "በመተግበሪያው፦ አባላት → ምክር ቤቶችን ወይም አባላትን ያክሉና ግብዣዎችን ይስጡ።",
    "Plan": "ዕቅድ",
    "No plan yet": "ገና ዕቅድ የለም",
    "Active until {date}": "እስከ {date} ንቁ ነው",
    "Ended on {date}": "በ{date} አብቅቷል",
    "Exempt (no plan needed)": "ነጻ (ዕቅድ አያስፈልግም)",
    "{used} of {cap} members": "{used} ከ{cap} አባላት",
    "Without a plan the organisation can have up to {n} members — enough to set up and rehearse.": "ያለ ዕቅድ ድርጅቱ እስከ {n} አባላት ሊኖሩት ይችላል — ለማዘጋጀትና ለልምምድ ይበቃል።",
    "Payment under review": "ክፍያው እየተገመገመ ነው",
    "We will message you in Telegram when it is checked.": "ሲረጋገጥ በቴሌግራም መልዕክት እንልክልዎታለን።",
    "Buy a plan": "ዕቅድ ይግዙ",
    "Extend or upgrade": "ያራዝሙ ወይም ያሳድጉ",
    "Country": "አገር",
    "Choose a plan": "ዕቅድ ይምረጡ",
    "Send the money to": "ገንዘቡን ወደዚህ ይላኩ",
    "Account name": "የሂሳብ ስም",
    "Account number": "የሂሳብ ቁጥር",
    "Transaction reference": "የግብይት መለያ ቁጥር",
    "As printed on the receipt or in the SMS.": "በደረሰኙ ወይም በኤስኤምኤስ ላይ እንደተጻፈው።",
    "Receipt (photo or PDF)": "ደረሰኝ (ፎቶ ወይም PDF)",
    "Send for review": "ለግምገማ ላክ",
    "Payment sent for review": "ክፍያው ለግምገማ ተልኳል",
    "No plan is priced in this country yet.": "በዚህ አገር እስካሁን ዋጋ የወጣለት ዕቅድ የለም።",
    "No account is listed for this country yet. Contact Kene Technologies.": "ለዚህ አገር እስካሁን የተዘረዘረ ሂሳብ የለም። Kene Technologiesን ያነጋግሩ።",
    "Payments": "ክፍያዎች",
    "pending": "በግምገማ ላይ",
    "approved": "ጸድቋል",
    "rejected": "ተቀባይነት አላገኘም",
    "The receipt file is too large.": "የደረሰኝ ፋይሉ በጣም ትልቅ ነው።",
    "Choose a plan and an account.": "ዕቅድና ሂሳብ ይምረጡ።",
    "Something went wrong": "የሆነ ችግር ተፈጥሯል",
    "Back to the app": "ወደ መተግበሪያው ተመለስ",
    "administrator": "አስተዳዳሪ",
    "creator": "ፈጣሪ",
    "group linked": "ቡድን ተገናኝቷል",
    "no group yet": "ገና ቡድን የለም",
    "Note": "ማሳሰቢያ",
  };
  function T(s, vars) {
    var out = lang === "am" && AM[s] ? AM[s] : s;
    if (vars) out = out.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] !== undefined ? String(vars[k]) : m; });
    return out;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function day(iso) { try { return new Date(iso).toLocaleDateString(lang === "am" ? "am-ET" : "en-GB", { year: "numeric", month: "short", day: "numeric" }); } catch (_) { return String(iso).slice(0, 10); } }
  function when(iso) { try { return new Date(iso).toLocaleString(lang === "am" ? "am-ET" : "en-GB"); } catch (_) { return String(iso); } }
  function money(n, c) { return Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " " + c; }

  var toastTimer = null;
  function toast(msg, kind) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.className = "toast" + (kind ? " " + kind : "");
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3500);
  }
  function fail(err) { toast((err && err.message) || T("Something went wrong"), "err"); }

  // ------------------------------------------------------------- API
  var token = load("kvb_token");
  async function api(method, path, body) {
    var headers = { "content-type": "application/json" };
    if (token) headers.authorization = "Bearer " + token;
    else if (tg) headers.authorization = "tma " + tg.initData;
    var res = await fetch(API + "/api/biz" + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) });
    var data = null;
    try { data = await res.json(); } catch (_) { /* empty */ }
    if (res.status === 401 && token) { token = null; save("kvb_token", null); me = null; }
    if (!res.ok) { var e = new Error((data && data.error) || "HTTP " + res.status); e.status = res.status; e.code = data && data.code; throw e; }
    return data;
  }

  var me = null; // { account, platform_admin, orgs, links }
  var catalog = null;
  async function refreshMe() {
    if (!token && !tg) { me = null; return null; }
    try { me = await api("GET", "/me"); } catch (err) { if (err.status === 401) me = null; else throw err; }
    return me;
  }
  function signedIn() { return Boolean(me); }

  async function signOut() {
    token = null; save("kvb_token", null); me = null;
    location.hash = "#/";
    route();
  }

  // ------------------------------------------------------------- header
  function renderNav() {
    var html = "";
    if (tg) html += '<a class="btn ghost sm" href="' + esc(API + "/app/") + '">← ' + esc(T("Back to the app")) + "</a>";
    if (signedIn()) {
      html += '<a class="btn ghost sm" href="#/">' + esc(T("My organisations")) + "</a>";
      if (me.platform_admin) html += '<a class="btn ghost sm" href="#/admin">💼 ' + esc(T("Console")) + "</a>";
      if (!tg) html += '<button class="btn ghost sm" data-out>' + esc(T("Sign out")) + "</button>";
    } else {
      html += '<a class="btn sm" href="#/login">' + esc(T("Sign in")) + "</a>";
    }
    html += '<button class="btn secondary sm" data-lang>' + (lang === "am" ? "English" : "አማርኛ") + "</button>";
    nav.innerHTML = html;
    var out = nav.querySelector("[data-out]");
    if (out) out.onclick = signOut;
    nav.querySelector("[data-lang]").onclick = function () { lang = lang === "am" ? "en" : "am"; save("kvb_lang", lang); document.documentElement.lang = lang; route(); };
  }

  // ------------------------------------------------------------- router
  var seq = 0;
  async function route() {
    var my = ++seq;
    var h = location.hash.replace(/^#\/?/, "");
    var parts = h.split("?")[0].split("/").filter(Boolean);
    main.innerHTML = '<div class="center"><div class="spinner"></div></div>';
    try {
      if (!catalog) catalog = await api("GET", "/catalog");
      if (me === null && (token || tg)) await refreshMe();
      if (my !== seq) return;
      renderNav();
      var page = parts[0] || "";
      var needsSignIn = page === "new" || page === "org" || page === "admin";
      if (needsSignIn && !signedIn()) { save("kvb_after", "#/" + h); return goLogin(); }
      if (page === "login") return viewLogin();
      if (page === "new") return viewNew();
      if (page === "org" && parts[1]) return viewOrg(parts[1]);
      if (page === "admin") return viewAdmin(parts[1] || "overview", parts[2]);
      return signedIn() ? viewDashboard() : viewLanding();
    } catch (err) {
      if (my !== seq) return;
      main.innerHTML = '<div class="card"><p>' + esc(err.message) + '</p><button class="btn" data-retry>' + esc(T("Try again")) + "</button></div>";
      main.querySelector("[data-retry]").onclick = route;
    }
  }
  function goLogin() { location.hash = "#/login"; }
  window.addEventListener("hashchange", route);

  // ------------------------------------------------------------- landing (signed out)
  function plansHtml(country) {
    var plans = catalog.plans.filter(function (p) { return p.prices.some(function (x) { return x.country === country; }); });
    if (!plans.length) return '<p class="muted">' + esc(T("No plans are on offer yet.")) + "</p>";
    return '<div class="grid">' + plans.map(function (p) {
      var pr = p.prices.filter(function (x) { return x.country === country; })[0];
      return '<div class="card"><h3>' + esc(lang === "am" && p.name_am ? p.name_am : p.name_en) + '</h3><div class="price">' + esc(money(pr.price, pr.currency)) + "</div>" +
        '<p class="hint">' + esc(T("{n} days", { n: p.duration_days })) + " · " + esc(p.member_cap ? T("up to {n} members", { n: p.member_cap }) : T("no member limit")) + "</p>" +
        (p.description ? "<p>" + esc(p.description) + "</p>" : "") + "</div>";
    }).join("") + "</div>";
  }
  function countryPicker(countries, chosen, attr) {
    if (countries.length < 2) return "";
    return '<select ' + attr + ' style="width:auto">' + countries.map(function (c) { return "<option" + (c === chosen ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") + "</select>";
  }

  function viewLanding() {
    var countries = catalog.countries;
    var country = countries.indexOf("ET") >= 0 ? "ET" : countries[0];
    main.innerHTML =
      '<section class="hero"><h1>' + esc(T("Run your association's general assembly votes on Telegram")) + '</h1><p class="lead">' +
      esc(T("Members register with an invitation, vote from their phones with secret or open ballots, move and second motions, and you get quorum, results and the assembly report — all inside Telegram.")) + "</p>" +
      '<div class="actions"><a class="btn" href="#/new">🚀 ' + esc(T("Create your organisation")) + '</a><button class="btn secondary" data-scroll>' + esc(T("See the plans")) + "</button></div></section>" +
      "<h2>" + esc(T("How it works")) + '</h2><div class="card"><ol class="steps">' +
      "<li>" + esc(T("Sign in with Telegram and create your organisation. You become its administrator.")) + "</li>" +
      "<li>" + esc(T("Add the bot to your Telegram group (with Topics) and set up your councils or members. Try everything with up to {n} members for free.", { n: catalog.trial_member_cap })) + "</li>" +
      "<li>" + esc(T("Buy a plan by bank or mobile-money transfer, send the receipt, and run your assembly.")) + "</li></ol></div>" +
      '<h2 id="plans">' + esc(T("Plans")) + " " + (countries.length > 1 ? '<span class="hint">' + esc(T("Prices in")) + " " + countryPicker(countries, country, "data-country") + "</span>" : "") + "</h2>" +
      '<div data-plans>' + (country ? plansHtml(country) : '<p class="muted">' + esc(T("No plans are on offer yet.")) + "</p>") + "</div>";
    var sel = main.querySelector("[data-country]");
    if (sel) sel.onchange = function () { main.querySelector("[data-plans]").innerHTML = plansHtml(sel.value); };
    main.querySelector("[data-scroll]").onclick = function () { document.getElementById("plans").scrollIntoView({ behavior: "smooth" }); };
  }

  // ------------------------------------------------------------- sign in through the bot
  var polling = null;
  async function viewLogin() {
    if (signedIn()) { location.hash = load("kvb_after") || "#/"; save("kvb_after", null); return; }
    clearInterval(polling);
    var start = await api("POST", "/login/start", { ref: load("kvb_ref") });
    main.innerHTML = '<div class="card" style="max-width:520px;margin:20px auto"><h1>' + esc(T("Sign in with Telegram")) + "</h1><p>" +
      esc(T("Tap the button: Telegram opens the Kene Voting bot. Tap Start there, then come back to this page — it continues by itself.")) + "</p>" +
      '<div class="actions"><a class="btn block" target="_blank" rel="noopener" href="' + esc(start.link) + '">✈️ ' + esc(T("Open Telegram")) + "</a></div>" +
      '<p class="hint" data-status style="margin-top:12px"><span class="spinner" style="display:inline-block;width:14px;height:14px;border-width:2px;vertical-align:-2px"></span> ' + esc(T("Waiting for Telegram…")) + "</p></div>";
    var my = seq;
    polling = setInterval(async function () {
      if (my !== seq) return clearInterval(polling);
      try {
        var r = await api("GET", "/login/poll?nonce=" + encodeURIComponent(start.nonce));
        if (r.status === "pending") return;
        clearInterval(polling);
        if (r.status === "ok") {
          token = r.token; save("kvb_token", token); save("kvb_ref", null);
          await refreshMe();
          toast(T("Signed in"), "ok");
          var after = load("kvb_after"); save("kvb_after", null);
          location.hash = after || "#/";
          if (!after || after === location.hash) route();
        } else {
          main.querySelector("[data-status]").innerHTML = esc(T("The link expired. Try again.")) + ' <button class="btn sm" data-again>' + esc(T("Try again")) + "</button>";
          main.querySelector("[data-again]").onclick = viewLogin;
        }
      } catch (_) { /* keep waiting */ }
    }, 2000);
  }

  // ------------------------------------------------------------- dashboard (signed in)
  function statusChip(b) {
    if (!b) return "";
    if (b.pending_payment) return '<span class="chip warn">⏳ ' + esc(T("Payment under review")) + "</span>";
    if (b.status === "exempt") return '<span class="chip muted">' + esc(T("Exempt (no plan needed)")) + "</span>";
    if (b.status === "active") return '<span class="chip ok">' + esc(T("Active until {date}", { date: day(b.paid_until) })) + "</span>";
    if (b.status === "expired") return '<span class="chip err">' + esc(T("Ended on {date}", { date: day(b.paid_until) })) + "</span>";
    return '<span class="chip">' + esc(T("No plan yet")) + "</span>";
  }
  function name(a) { return [a.first_name, a.last_name].filter(Boolean).join(" ") || (a.username ? "@" + a.username : String(a.telegram_user_id)); }

  function shareCard() {
    var link = me.account.share_link;
    var text = T("Run your association's general assembly votes on Telegram");
    return '<div class="card"><h3>📣 ' + esc(T("Share Kene Voting")) + '</h3><p class="hint">' + esc(T("Know an association that votes? Send them your link — they can create their own organisation.")) + "</p>" +
      '<div class="copy"><input readonly value="' + esc(link) + '" data-link><button class="btn secondary" data-copy>' + esc(T("Copy")) + "</button></div>" +
      '<div class="actions"><a class="btn sm" target="_blank" rel="noopener" href="https://t.me/share/url?url=' + encodeURIComponent(link) + "&text=" + encodeURIComponent(text) + '">✈️ ' + esc(T("Share in Telegram")) + "</a></div></div>";
  }
  function wireCopy(root) {
    root.querySelectorAll("[data-copy]").forEach(function (b) {
      b.onclick = function () {
        var input = b.parentNode.querySelector("input");
        var done = function () { toast(T("Copied"), "ok"); };
        if (navigator.clipboard) navigator.clipboard.writeText(input.value).then(done, function () { input.select(); document.execCommand("copy"); done(); });
        else { input.select(); document.execCommand("copy"); done(); }
      };
    });
  }

  function viewDashboard() {
    var orgs = me.orgs || [];
    main.innerHTML = "<h1>" + esc(T("Welcome, {name}", { name: name(me.account) })) + "</h1>" +
      "<h2>" + esc(T("My organisations")) + "</h2>" +
      (orgs.length ? '<div class="list">' + orgs.map(function (o) {
        var b = o.billing;
        return '<a class="item" href="#/org/' + esc(o.id) + '"><div class="grow"><div class="title">' + esc(o.name_en) + ' <span class="hint">' + esc(o.short_code) + "</span></div>" +
          '<div class="hint">' + esc(o.is_creator ? T("creator") : T("administrator")) + " · " + esc(o.group_linked ? T("group linked") : T("no group yet")) +
          (b && !b.exempt ? " · " + esc(T("{used} of {cap} members", { used: b.members_used, cap: b.member_cap == null ? "∞" : b.member_cap })) : "") + "</div></div>" + statusChip(b) + "</a>";
      }).join("") + "</div>" : '<div class="card"><p class="muted">' + esc(T("You have no organisation yet.")) + "</p></div>") +
      '<div class="actions"><a class="btn" href="#/new">' + esc(T("＋ Create an organisation")) + "</a></div>" +
      shareCard();
    wireCopy(main);
  }

  // ------------------------------------------------------------- create an organisation
  function viewNew() {
    var vt = catalog.terms.voter, gt = catalog.terms.group;
    function opts(map, sel) { return Object.keys(map).map(function (k) { return '<option value="' + esc(k) + '"' + (k === sel ? " selected" : "") + ">" + esc(map[k].en_pl || k) + "</option>"; }).join(""); }
    main.innerHTML = '<div class="card" style="max-width:640px;margin:0 auto"><h1>' + esc(T("New organisation")) + "</h1>" +
      '<div class="field"><label>' + esc(T("Organisation name")) + '</label><input data-f="name_en" maxlength="160" placeholder="Association of …"></div>' +
      '<div class="field"><label>' + esc(T("Name in Amharic (optional)")) + '</label><input data-f="name_am" maxlength="160"></div>' +
      '<div class="field"><label>' + esc(T("Short code")) + '</label><input data-f="short_code" maxlength="8" style="text-transform:uppercase" placeholder="AEA"><p class="hint">' + esc(T("2–8 letters; invitation codes start with it (for example AEA-K7M2P).")) + "</p></div>" +
      '<div class="field"><label>' + esc(T("How do members vote?")) + "</label>" +
      '<label class="choice on"><input type="radio" name="structure" value="councils" checked><span class="grow">' + esc(T("Through councils (chapters, regions) that send delegates")) + "</span></label>" +
      '<label class="choice"><input type="radio" name="structure" value="direct"><span class="grow">' + esc(T("Directly — every member votes for themselves")) + "</span></label></div>" +
      '<div class="row2"><div class="field"><label>Voters are called</label><select data-f="voter_term">' + opts(vt, "delegate") + '</select></div><div class="field" data-groupterm><label>Their bodies are called</label><select data-f="group_term">' + opts(gt, "council") + "</select></div></div>" +
      '<div class="row2"><div class="field"><label>' + esc(T("Assembly (optional)")) + '</label><input data-f="assembly_en" maxlength="160" placeholder="General Assembly 2026"></div>' +
      '<div class="field"><label>' + esc(T("Office that issues invitations (optional)")) + '</label><input data-f="office_en" maxlength="160" placeholder="Secretariat"></div></div>' +
      '<div class="actions"><button class="btn" data-go>' + esc(T("Create")) + '</button><a class="btn secondary" href="#/">' + esc(T("Back")) + "</a></div></div>";
    main.querySelectorAll('input[name="structure"]').forEach(function (r) {
      r.onchange = function () {
        main.querySelectorAll(".choice").forEach(function (c) { c.classList.toggle("on", c.querySelector("input").checked); });
        main.querySelector("[data-groupterm]").style.display = r.value === "direct" && r.checked ? "none" : "";
      };
    });
    var nameIn = main.querySelector('[data-f="name_en"]'), codeIn = main.querySelector('[data-f="short_code"]');
    nameIn.oninput = function () {
      if (codeIn.dataset.touched) return;
      codeIn.value = nameIn.value.split(/\s+/).filter(function (w) { return w && !/^(of|the|and|for)$/i.test(w); }).map(function (w) { return w[0]; }).join("").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    };
    codeIn.oninput = function () { codeIn.dataset.touched = "1"; };
    main.querySelector("[data-go]").onclick = async function () {
      var body = {};
      main.querySelectorAll("[data-f]").forEach(function (el) { body[el.dataset.f] = el.value.trim(); });
      body.structure = main.querySelector('input[name="structure"]:checked').value;
      this.disabled = true;
      try {
        var r = await api("POST", "/orgs", body);
        await refreshMe();
        toast(T("Organisation created"), "ok");
        location.hash = "#/org/" + r.org.id;
      } catch (err) { fail(err); this.disabled = false; }
    };
  }

  // ------------------------------------------------------------- one organisation: status, next steps, paying
  async function viewOrg(id) {
    var d = await api("GET", "/orgs/" + id);
    var o = d.org, b = o.billing, L = d.links;
    var html = '<a href="#/" class="hint">← ' + esc(T("My organisations")) + "</a><h1>" + esc(o.name_en) + ' <span class="hint">' + esc(o.short_code) + "</span></h1>";
    if (!o.group_linked) {
      html += '<div class="card"><h3>' + esc(T("Next steps")) + '</h3><ol class="steps">' +
        "<li>" + esc(T("Create a Telegram group with Topics switched on, then add the bot as administrator with this link.")) + '<div class="actions"><a class="btn sm" target="_blank" rel="noopener" href="' + esc(L.add_to_group) + '">➕ ' + esc(T("Add the bot to your group")) + "</a></div></li>" +
        "<li>" + esc(T("In the app: Members → add councils or members and issue invitations.")) + '<div class="actions"><a class="btn sm secondary" target="_blank" rel="noopener" href="' + esc(L.app) + '">🗳 ' + esc(T("Open the app")) + "</a></div></li></ol></div>";
    } else {
      html += '<div class="actions"><a class="btn secondary" target="_blank" rel="noopener" href="' + esc(L.app) + '">🗳 ' + esc(T("Open the app")) + "</a></div>";
    }
    html += '<div class="card"><h3>💳 ' + esc(T("Plan")) + " " + statusChip(b) + "</h3>";
    if (b.status !== "exempt") {
      html += "<p>" + (b.plan_name ? "<b>" + esc(b.plan_name) + "</b> · " : "") + esc(T("{used} of {cap} members", { used: b.members_used, cap: b.member_cap == null ? "∞" : b.member_cap })) + "</p>";
      if (b.status === "trial" || b.status === "expired") html += '<p class="hint">' + esc(T("Without a plan the organisation can have up to {n} members — enough to set up and rehearse.", { n: b.trial_member_cap })) + "</p>";
    }
    html += "</div>";
    if (b.status !== "exempt") {
      if (b.pending_payment) {
        html += '<div class="card"><h3>⏳ ' + esc(T("Payment under review")) + "</h3><p>" + esc(b.pending_payment.plan_name) + " · " + esc(money(b.pending_payment.amount, b.pending_payment.currency)) + '</p><p class="hint">' + esc(T("We will message you in Telegram when it is checked.")) + "</p></div>";
      } else {
        html += '<div class="card" data-buy><h3>' + esc(b.status === "active" ? T("Extend or upgrade") : T("Buy a plan")) + '</h3><div data-pay><div class="spinner"></div></div></div>';
      }
    }
    if (d.payments.length) {
      html += "<h2>" + esc(T("Payments")) + '</h2><div class="list">' + d.payments.map(function (p) {
        return '<div class="item"><div class="grow"><div class="title">' + esc(p.plan_name) + " · " + esc(money(p.amount, p.currency)) + '</div><div class="hint">' + esc(when(p.created_at)) + " · ref " + esc(p.reference) +
          (p.review_note ? " · " + esc(T("Note")) + ": " + esc(p.review_note) : "") + (p.period_end ? " · → " + esc(day(p.period_end)) : "") + "</div></div>" +
          '<span class="chip ' + (p.status === "approved" ? "ok" : p.status === "rejected" ? "err" : "warn") + '">' + esc(T(p.status)) + "</span></div>";
      }).join("") + "</div>";
    }
    main.innerHTML = html;
    if (main.querySelector("[data-pay]")) payForm(id, main.querySelector("[data-pay]"), null);
  }

  /** Plan → account → reference and receipt → sent for review. */
  async function payForm(orgId, box, country) {
    var o = await api("GET", "/orgs/" + orgId + "/pay-options" + (country ? "?country=" + country : ""));
    if (!o.country) { box.innerHTML = '<p class="muted">' + esc(T("No plans are on offer yet.")) + "</p>"; return; }
    var html = o.countries.length > 1 ? '<div class="field"><label>' + esc(T("Country")) + "</label>" + countryPicker(o.countries, o.country, "data-country") + "</div>" : "";
    if (!o.plans.length) { box.innerHTML = html + '<p class="muted">' + esc(T("No plan is priced in this country yet.")) + "</p>"; wireCountry(); return; }
    html += '<div class="field"><label>' + esc(T("Choose a plan")) + "</label>" + o.plans.map(function (p, i) {
      return '<label class="choice' + (i === 0 ? " on" : "") + '"><input type="radio" name="plan" value="' + esc(p.id) + '"' + (i === 0 ? " checked" : "") + '><span class="grow"><b>' + esc(lang === "am" && p.name_am ? p.name_am : p.name_en) + "</b><br><span class=\"hint\">" +
        esc(T("{n} days", { n: p.duration_days })) + " · " + esc(p.member_cap ? T("up to {n} members", { n: p.member_cap }) : T("no member limit")) + "</span></span><b>" + esc(money(p.price.price, p.price.currency)) + "</b></label>";
    }).join("") + "</div>";
    if (!o.methods.length) html += '<p class="muted">' + esc(T("No account is listed for this country yet. Contact Kene Technologies.")) + "</p>";
    else {
      html += '<div class="field"><label>' + esc(T("Send the money to")) + "</label>" + o.methods.map(function (m, i) {
        return '<label class="choice' + (i === 0 ? " on" : "") + '"><input type="radio" name="method" value="' + esc(m.id) + '"' + (i === 0 ? " checked" : "") + '><span class="grow"><b>' + esc(m.provider) + "</b><br>" +
          esc(T("Account name")) + ": " + esc(m.account_name) + '<br><span class="copy" style="margin-top:4px"><input readonly value="' + esc(m.account_number) + '"><button type="button" class="btn secondary sm" data-copy>' + esc(T("Copy")) + "</button></span>" +
          (m.note ? '<span class="hint">' + esc(m.note) + "</span>" : "") + "</span></label>";
      }).join("") + "</div>" +
        '<div class="field"><label>' + esc(T("Transaction reference")) + '</label><input data-ref maxlength="80"><p class="hint">' + esc(T("As printed on the receipt or in the SMS.")) + "</p></div>" +
        '<div class="field"><label>' + esc(T("Receipt (photo or PDF)")) + '</label><input type="file" accept="image/*,application/pdf" data-file></div>' +
        '<button class="btn block" data-send>' + esc(T("Send for review")) + "</button>";
    }
    box.innerHTML = html;
    wireCountry();
    wireCopy(box);
    box.querySelectorAll(".choice input").forEach(function (r) {
      r.onchange = function () { box.querySelectorAll('input[name="' + r.name + '"]').forEach(function (x) { x.closest(".choice").classList.toggle("on", x.checked); }); };
    });
    var send = box.querySelector("[data-send]");
    if (send) send.onclick = async function () {
      var plan = box.querySelector('input[name="plan"]:checked'), method = box.querySelector('input[name="method"]:checked');
      if (!plan || !method) return toast(T("Choose a plan and an account."), "err");
      var btn = this;
      btn.disabled = true;
      try {
        var f = box.querySelector("[data-file]").files[0];
        var receipt = f ? await fileData(f) : null;
        await api("POST", "/orgs/" + orgId + "/payments", { plan_id: plan.value, method_id: method.value, country: o.country, reference: box.querySelector("[data-ref]").value.trim(), receipt: receipt });
        toast(T("Payment sent for review"), "ok");
        await refreshMe();
        viewOrg(orgId);
      } catch (err) { fail(err); btn.disabled = false; }
    };
    function wireCountry() {
      var sel = box.querySelector("[data-country]");
      if (sel) sel.onchange = function () { payForm(orgId, box, sel.value); };
    }
  }

  /** An image is shrunk to at most 1600 px (JPEG); a PDF is sent as it is (up to about 1.8 MB). */
  function fileData(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error(T("Something went wrong"))); };
      if (file.type === "application/pdf") {
        if (file.size > 1800000) return reject(new Error(T("The receipt file is too large.")));
        reader.onload = function () { resolve(reader.result); };
        return reader.readAsDataURL(file);
      }
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var scale = Math.min(1, 1600 / Math.max(img.width, img.height));
          var c = document.createElement("canvas");
          c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          var out = c.toDataURL("image/jpeg", 0.82);
          if (out.length > 2400000) return reject(new Error(T("The receipt file is too large.")));
          resolve(out);
        };
        img.onerror = function () { reject(new Error(T("Something went wrong"))); };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ------------------------------------------------------------- platform console (English)
  var ADMIN_TABS = [["overview", "Overview"], ["payments", "Payments"], ["orgs", "Organisations"], ["plans", "Plans"], ["methods", "Payment accounts"], ["accounts", "Sign-ups"], ["settings", "Settings"]];
  async function viewAdmin(tab, arg) {
    if (!me.platform_admin) { main.innerHTML = '<div class="card"><p>Only the platform administrators can open the console.</p></div>'; return; }
    var head = '<h1>💼 Business console</h1><div class="tabs">' + ADMIN_TABS.map(function (t) { return '<a href="#/admin/' + t[0] + '"' + (t[0] === tab ? ' class="on"' : "") + ">" + t[1] + "</a>"; }).join("") + "</div>";
    var body = "";
    if (tab === "overview") {
      var s = await api("GET", "/admin/summary");
      body = '<div class="stats">' +
        stat("Payments to review", s.payments.pending, "#/admin/payments") + stat("Organisations", s.organisations.total) + stat("Active plans", s.organisations.active) +
        stat("Without a plan", s.organisations.trial) + stat("Expired", s.organisations.expired) + stat("Exempt", s.organisations.exempt) +
        stat("Sign-ups", s.accounts.total) + stat("Sign-ups this month", s.accounts.this_month) + stat("Came through a share link", s.accounts.referred) + "</div>" +
        "<h2>Revenue (approved payments)</h2>" + (s.revenue.length ? '<div class="scroll"><table><tr><th>Currency</th><th>Total</th><th>This month</th><th>Payments</th></tr>' + s.revenue.map(function (r) {
          return "<tr><td>" + esc(r.currency) + "</td><td>" + esc(money(r.total, r.currency)) + "</td><td>" + esc(money(r.month, r.currency)) + "</td><td>" + r.count + "</td></tr>";
        }).join("") + "</table></div>" : '<p class="muted">No approved payment yet.</p>');
      main.innerHTML = head + body;
      return;
    }
    if (tab === "payments" && arg) return adminPayment(head, arg);
    if (tab === "payments") {
      var st = new URLSearchParams(location.hash.split("?")[1] || "").get("s") || "pending";
      var ps = await api("GET", "/admin/payments?status=" + st);
      body = '<div class="tabs">' + ["pending", "approved", "rejected"].map(function (x) { return '<a href="#/admin/payments?s=' + x + '"' + (x === st ? ' class="on"' : "") + ">" + x + "</a>"; }).join("") + "</div>" +
        (ps.items.length ? '<div class="list">' + ps.items.map(function (p) {
          return '<a class="item" href="#/admin/payments/' + p.id + '"><div class="grow"><div class="title">' + esc(p.org_name || "?") + " — " + esc(p.plan_name) + '</div><div class="hint">' + esc(when(p.created_at)) + " · " + esc(p.method_label || "") + " · ref " + esc(p.reference) + "</div></div><b>" + esc(money(p.amount, p.currency)) + "</b></a>";
        }).join("") + "</div>" : '<p class="muted">Nothing here.</p>');
    }
    if (tab === "orgs") return adminOrgs(head);
    if (tab === "plans") return adminPlans(head);
    if (tab === "methods") return adminMethods(head);
    if (tab === "accounts") {
      var ac = await api("GET", "/admin/accounts");
      body = '<div class="scroll"><table><tr><th>Name</th><th>Signed up</th><th>Came through</th><th>Brought</th><th>Organisations</th><th>Last sign-in</th></tr>' + ac.items.map(function (a) {
        return "<tr><td>" + esc(a.name) + (a.username ? '<br><span class="hint">@' + esc(a.username) + "</span>" : "") + '<br><span class="hint">' + a.telegram_user_id + "</span></td><td>" + esc(day(a.created_at)) + "</td><td>" + esc(a.referred_by_name || "—") + "</td><td>" + a.referrals + "</td><td>" + a.organisations + "</td><td>" + esc(when(a.last_login_at)) + "</td></tr>";
      }).join("") + "</table></div>";
    }
    if (tab === "settings") {
      var se = await api("GET", "/admin/settings");
      body = '<div class="card" style="max-width:520px"><div class="field"><label>Members an organisation may have without a plan</label><input type="number" min="0" max="1000" data-cap value="' + se.trial_member_cap + '"><p class="hint">Enough to set up and rehearse. Organisations created by the platform administrators are exempt.</p></div><button class="btn" data-save>Save</button></div>';
      main.innerHTML = head + body;
      main.querySelector("[data-save]").onclick = async function () {
        try { await api("POST", "/admin/settings", { trial_member_cap: Number(main.querySelector("[data-cap]").value) }); toast("Saved", "ok"); } catch (err) { fail(err); }
      };
      return;
    }
    main.innerHTML = head + body;
  }
  function stat(label, n, href) { return (href ? '<a class="stat" style="text-decoration:none;color:inherit" href="' + href + '">' : '<div class="stat">') + "<b>" + n + '</b><span class="hint">' + esc(label) + "</span>" + (href ? "</a>" : "</div>"); }

  async function adminPayment(head, id) {
    var d = await api("GET", "/admin/payments/" + id);
    var p = d.payment, b = d.billing;
    var receipt = p.receipt ? (p.receipt.indexOf("data:application/pdf") === 0 ? '<a class="btn secondary" download="receipt-' + esc(p.reference) + '.pdf" href="' + p.receipt + '">📄 Download the PDF receipt</a>' : '<img alt="receipt" src="' + p.receipt + '">') : '<p class="muted">No receipt attached — check the reference.</p>';
    main.innerHTML = head + '<a class="hint" href="#/admin/payments">← Payments</a>' +
      '<div class="card"><h3>' + esc(p.org_name || "?") + " — " + esc(p.plan_name) + ' <span class="chip ' + (p.status === "approved" ? "ok" : p.status === "rejected" ? "err" : "warn") + '">' + esc(p.status) + "</span></h3>" +
      '<div class="scroll"><table>' +
      "<tr><th>Amount</th><td><b>" + esc(money(p.amount, p.currency)) + "</b> (" + esc(p.country) + ")</td></tr>" +
      "<tr><th>Paid to</th><td>" + esc(p.method_label || "—") + "</td></tr>" +
      "<tr><th>Reference</th><td>" + esc(p.reference) + "</td></tr>" +
      "<tr><th>Plan</th><td>" + p.duration_days + " days · " + (p.member_cap ? "up to " + p.member_cap + " members" : "no member limit") + "</td></tr>" +
      "<tr><th>Payer</th><td>" + esc(d.payer.first_name ? name(d.payer) : d.payer.telegram_user_id) + (d.payer.username ? ' <a target="_blank" rel="noopener" href="https://t.me/' + esc(d.payer.username) + '">@' + esc(d.payer.username) + "</a>" : "") + "</td></tr>" +
      "<tr><th>Filed</th><td>" + esc(when(p.created_at)) + "</td></tr>" +
      "<tr><th>Organisation now</th><td>" + esc(b.status) + (b.paid_until ? " · until " + esc(day(b.paid_until)) : "") + " · " + b.members_used + " members</td></tr>" +
      (p.review_note ? "<tr><th>Note</th><td>" + esc(p.review_note) + "</td></tr>" : "") +
      (p.period_end ? "<tr><th>Period</th><td>" + esc(day(p.period_start)) + " → " + esc(day(p.period_end)) + "</td></tr>" : "") +
      '</table></div><div class="receipt" style="margin-top:12px">' + receipt + "</div>" +
      (p.status === "pending" ? '<div class="actions"><button class="btn ok" data-approve>✅ Approve</button><button class="btn danger" data-reject>Reject…</button></div>' : "") + "</div>";
    var ap = main.querySelector("[data-approve]");
    if (ap) ap.onclick = async function () {
      if (!confirm("Approve " + money(p.amount, p.currency) + " and extend " + (p.org_name || "the organisation") + " by " + p.duration_days + " days?")) return;
      try { await api("POST", "/admin/payments/" + id + "/approve"); toast("Approved — the payer was told in Telegram", "ok"); adminPayment(head, id); } catch (err) { fail(err); }
    };
    var rj = main.querySelector("[data-reject]");
    if (rj) rj.onclick = async function () {
      var note = prompt("Why is it rejected? The payer sees this (for example: amount does not match, receipt unreadable).");
      if (!note) return;
      try { await api("POST", "/admin/payments/" + id + "/reject", { note: note }); toast("Rejected — the payer was told", "ok"); adminPayment(head, id); } catch (err) { fail(err); }
    };
  }

  async function adminOrgs(head) {
    var d = await api("GET", "/admin/orgs");
    main.innerHTML = head + '<div class="list">' + d.items.map(function (o) {
      var b = o.billing;
      return '<div class="item"><div class="grow"><div class="title">' + esc(o.name_en) + ' <span class="hint">' + esc(o.short_code) + '</span></div><div class="hint">' +
        (o.creator ? "by " + esc(o.creator.name || o.creator.telegram_user_id) + (o.creator.referred_by_name ? " (via " + esc(o.creator.referred_by_name) + ")" : "") + " · " : "created by the platform · ") +
        esc(day(o.created_at)) + " · " + (o.group_linked ? "group linked" : "no group") + " · " + b.members_used + (b.member_cap == null ? "" : "/" + b.member_cap) + " members</div></div>" + statusChip(b) +
        '<button class="btn secondary sm" data-adjust="' + o.id + '">Adjust…</button></div>';
    }).join("") + "</div>";
    main.querySelectorAll("[data-adjust]").forEach(function (btn) {
      btn.onclick = async function () {
        var o = d.items.filter(function (x) { return x.id === btn.dataset.adjust; })[0];
        var what = prompt("For " + o.name_en + ":\n• a number of days to add (e.g. 30, or -7)\n• \"cap N\" to set the member limit (\"cap none\" for no limit)\n• \"exempt on\" / \"exempt off\"", "30");
        if (!what) return;
        try {
          var m;
          if ((m = /^exempt\s+(on|off)$/i.exec(what.trim()))) await api("POST", "/admin/orgs/" + o.id + "/exempt", { on: m[1].toLowerCase() === "on" });
          else if ((m = /^cap\s+(none|\d+)$/i.exec(what.trim()))) await api("POST", "/admin/orgs/" + o.id + "/adjust", { member_cap: m[1].toLowerCase() === "none" ? null : Number(m[1]) });
          else if (/^-?\d+$/.test(what.trim())) await api("POST", "/admin/orgs/" + o.id + "/adjust", { days: Number(what.trim()) });
          else return toast("Not understood", "err");
          toast("Saved", "ok");
          adminOrgs(head);
        } catch (err) { fail(err); }
      };
    });
  }

  async function adminPlans(head) {
    var d = await api("GET", "/admin/plans");
    main.innerHTML = head + '<div class="actions"><button class="btn" data-new>＋ New plan</button></div><div class="grid" style="margin-top:12px">' + d.items.map(function (p) {
      return '<div class="card"><h3>' + esc(p.name_en) + (p.active ? "" : ' <span class="chip muted">hidden</span>') + '</h3><p class="hint">' + p.duration_days + " days · " + (p.member_cap ? "up to " + p.member_cap + " members" : "no member limit") + "</p>" +
        "<p>" + (p.prices.map(function (x) { return esc(x.country + " " + money(x.price, x.currency)); }).join("<br>") || '<span class="muted">no price yet — not on offer</span>') + "</p>" +
        '<button class="btn secondary sm" data-edit="' + p.id + '">Edit</button></div>';
    }).join("") + "</div>";
    main.querySelector("[data-new]").onclick = function () { planEditor(head, null); };
    main.querySelectorAll("[data-edit]").forEach(function (b) { b.onclick = function () { planEditor(head, d.items.filter(function (p) { return p.id === b.dataset.edit; })[0]); }; });
  }

  function planEditor(head, p) {
    p = p || { name_en: "", name_am: "", description: "", duration_days: 30, member_cap: 100, active: true, sort: 0, prices: [{ country: "ET", price: 0, currency: "ETB" }] };
    function priceRow(x) { return '<div class="p"><input data-pc maxlength="2" value="' + esc(x.country) + '" placeholder="ET"><input data-pp type="number" min="0" step="0.01" value="' + esc(x.price) + '"><input data-pcur maxlength="3" value="' + esc(x.currency) + '" placeholder="ETB"><button class="btn secondary sm" data-rm>✕</button></div>'; }
    main.innerHTML = head + '<div class="card" style="max-width:640px"><h3>' + (p.id ? "Edit plan" : "New plan") + "</h3>" +
      '<div class="row2"><div class="field"><label>Name</label><input data-f="name_en" value="' + esc(p.name_en) + '" placeholder="Assembly pass"></div><div class="field"><label>Name in Amharic</label><input data-f="name_am" value="' + esc(p.name_am || "") + '"></div></div>' +
      '<div class="field"><label>Description</label><textarea data-f="description">' + esc(p.description || "") + "</textarea></div>" +
      '<div class="row2"><div class="field"><label>Duration (days)</label><input type="number" min="1" data-f="duration_days" value="' + p.duration_days + '"></div><div class="field"><label>Member limit (empty = none)</label><input type="number" min="1" data-f="member_cap" value="' + (p.member_cap == null ? "" : p.member_cap) + '"></div></div>' +
      '<div class="row2"><div class="field"><label>Order</label><input type="number" min="0" data-f="sort" value="' + (p.sort || 0) + '"></div><div class="field"><label><input type="checkbox" data-active style="width:auto"' + (p.active ? " checked" : "") + "> On offer</label></div></div>" +
      '<div class="field prices-edit"><label>Prices per country (ISO code · price · currency)</label><div data-prices>' + p.prices.map(priceRow).join("") + '</div><button class="btn secondary sm" data-addp>＋ Country</button></div>' +
      '<div class="actions"><button class="btn" data-save>Save</button><a class="btn secondary" href="#/admin/plans">Cancel</a></div></div>';
    var box = main.querySelector("[data-prices]");
    function wireRm() { box.querySelectorAll("[data-rm]").forEach(function (b) { b.onclick = function () { b.parentNode.remove(); }; }); }
    wireRm();
    main.querySelector("[data-addp]").onclick = function () { box.insertAdjacentHTML("beforeend", priceRow({ country: "", price: "", currency: "" })); wireRm(); };
    main.querySelector("[data-save]").onclick = async function () {
      var body = {};
      main.querySelectorAll("[data-f]").forEach(function (el) { body[el.dataset.f] = el.value.trim(); });
      body.duration_days = Number(body.duration_days);
      body.member_cap = body.member_cap === "" ? null : Number(body.member_cap);
      body.sort = Number(body.sort || 0);
      body.active = main.querySelector("[data-active]").checked;
      body.prices = [].map.call(box.querySelectorAll(".p"), function (r) { return { country: r.querySelector("[data-pc]").value.trim().toUpperCase(), price: Number(r.querySelector("[data-pp]").value), currency: r.querySelector("[data-pcur]").value.trim().toUpperCase() }; }).filter(function (x) { return x.country; });
      try { await api(p.id ? "PATCH" : "POST", "/admin/plans" + (p.id ? "/" + p.id : ""), body); toast("Saved", "ok"); catalog = null; location.hash = "#/admin/plans"; adminPlans(head); } catch (err) { fail(err); }
    };
  }

  async function adminMethods(head) {
    var d = await api("GET", "/admin/methods");
    main.innerHTML = head + '<p class="hint">Creators send the money to these accounts; each is offered in its country.</p><div class="actions"><button class="btn" data-new>＋ New account</button></div>' +
      '<div class="list" style="margin-top:12px">' + (d.items.map(function (m) {
        return '<div class="item"><div class="grow"><div class="title">' + esc(m.country) + " · " + esc(m.provider) + (m.active ? "" : ' <span class="chip muted">hidden</span>') + '</div><div class="hint">' + esc(m.account_name) + " · " + esc(m.account_number) + (m.note ? " · " + esc(m.note) : "") + '</div></div><button class="btn secondary sm" data-edit="' + m.id + '">Edit</button></div>';
      }).join("") || '<div class="item muted">No account yet.</div>') + "</div>";
    main.querySelector("[data-new]").onclick = function () { methodEditor(head, null); };
    main.querySelectorAll("[data-edit]").forEach(function (b) { b.onclick = function () { methodEditor(head, d.items.filter(function (m) { return m.id === b.dataset.edit; })[0]); }; });
  }

  function methodEditor(head, m) {
    m = m || { country: "ET", provider: "", account_name: "Kene Technologies", account_number: "", note: "", active: true, sort: 0 };
    main.innerHTML = head + '<div class="card" style="max-width:560px"><h3>' + (m.id ? "Edit account" : "New account") + "</h3>" +
      '<div class="row2"><div class="field"><label>Country (ISO)</label><input data-f="country" maxlength="2" value="' + esc(m.country) + '"></div><div class="field"><label>Bank or service</label><input data-f="provider" value="' + esc(m.provider) + '" placeholder="Commercial Bank of Ethiopia / telebirr"></div></div>' +
      '<div class="row2"><div class="field"><label>Account name</label><input data-f="account_name" value="' + esc(m.account_name) + '"></div><div class="field"><label>Account number</label><input data-f="account_number" value="' + esc(m.account_number) + '"></div></div>' +
      '<div class="field"><label>Note for the payer (optional)</label><input data-f="note" value="' + esc(m.note || "") + '"></div>' +
      '<div class="row2"><div class="field"><label>Order</label><input type="number" data-f="sort" value="' + (m.sort || 0) + '"></div><div class="field"><label><input type="checkbox" data-active style="width:auto"' + (m.active ? " checked" : "") + "> Offered</label></div></div>" +
      '<div class="actions"><button class="btn" data-save>Save</button><a class="btn secondary" href="#/admin/methods">Cancel</a></div></div>';
    main.querySelector("[data-save]").onclick = async function () {
      var body = {};
      main.querySelectorAll("[data-f]").forEach(function (el) { body[el.dataset.f] = el.value.trim(); });
      body.country = body.country.toUpperCase();
      body.sort = Number(body.sort || 0);
      body.active = main.querySelector("[data-active]").checked;
      try { await api(m.id ? "PATCH" : "POST", "/admin/methods" + (m.id ? "/" + m.id : ""), body); toast("Saved", "ok"); location.hash = "#/admin/methods"; adminMethods(head); } catch (err) { fail(err); }
    };
  }

  // ------------------------------------------------------------- start
  if (tg) { try { tg.ready(); tg.expand(); } catch (_) { /* ignore */ } }
  document.documentElement.lang = lang;
  (async function () {
    // Inside Telegram without a session yet: sign in with the Mini App's identity.
    if (tg && !token) {
      try {
        var r = await api("POST", "/login/telegram", { ref: load("kvb_ref") });
        token = r.token; save("kvb_token", token); save("kvb_ref", null);
      } catch (_) { /* initData-only requests still work */ }
    }
    route();
  })();
})();
