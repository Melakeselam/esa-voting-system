/* ESA General Assembly Voting — Telegram Mini App (admin panel + member voting).
   Plain JavaScript, no build step. Talks to /api/app/* with Telegram initData auth.
   All user-facing text goes through t() (see i18n.js); the English string is the key. */
(function () {
  "use strict";

  var tg = window.Telegram && window.Telegram.WebApp;
  var app = document.getElementById("app");
  var toastEl = document.getElementById("toast");
  var I18N = window.I18N;
  var t = I18N.t;

  // ---------------------------------------------------------------- helpers
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function h(html) {
    var tpl = document.createElement("template");
    tpl.innerHTML = html.trim();
    return tpl.content.firstElementChild;
  }
  function on(root, selector, event, fn) {
    root.querySelectorAll(selector).forEach(function (node) { node.addEventListener(event, fn); });
  }
  var toastTimer;
  function toast(msg, kind) {
    toastEl.textContent = msg;
    toastEl.className = "toast" + (kind ? " " + kind : "");
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2800);
  }
  function haptic(kind) {
    try {
      if (kind === "error" || kind === "success" || kind === "warning") tg.HapticFeedback.notificationOccurred(kind);
      else tg.HapticFeedback.impactOccurred(kind || "light");
    } catch (_) { /* older clients */ }
  }
  function confirmDialog(message) {
    return new Promise(function (resolve) {
      try { tg.showConfirm(message, function (ok) { resolve(!!ok); }); }
      catch (_) { resolve(window.confirm(message)); }
    });
  }
  function alertDialog(message) {
    return new Promise(function (resolve) {
      try { tg.showAlert(message, function () { resolve(); }); }
      catch (_) { window.alert(message); resolve(); }
    });
  }
  function fail(err) {
    haptic("error");
    toast(err && err.message ? err.message : t("Something went wrong"), "err");
  }
  function thresholdLabel(th) { return th === "two_thirds" ? t("2/3 majority") : t("simple majority"); }
  function statusBadge(status) {
    var label = status === "open" ? "🟢 " + t("Open") : status === "closed" ? "🔴 " + t("Closed") : "⚪ " + t("Draft");
    return '<span class="badge ' + status + '">' + label + "</span>";
  }
  /** "3 options" — the dictionary holds both the singular and the plural word. */
  function plural(n, word) { return n + " " + t(n === 1 ? word : word + "s"); }
  function fmtDate(iso) { try { return new Date(iso).toLocaleString(I18N.locale()); } catch (_) { return String(iso); } }
  function fmtTime(iso) { try { return new Date(iso).toLocaleTimeString(I18N.locale()); } catch (_) { return String(iso); } }

  async function api(method, path, body) {
    var res = await fetch("/api/app" + path, {
      method: method,
      headers: { "content-type": "application/json", authorization: "tma " + tg.initData },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    var data = null;
    try { data = await res.json(); } catch (_) { /* no body */ }
    if (!res.ok) {
      var err = new Error((data && data.error) || t("Request failed ({status})", { status: res.status }));
      err.status = res.status;
      err.code = data && data.code;
      throw err;
    }
    return data;
  }

  // ------------------------------------------------------------- navigation
  var state = { me: null, stack: [], renderSeq: 0 };

  function current() { return state.stack[state.stack.length - 1]; }
  function go(name, params, opts) {
    params = params || {};
    opts = opts || {};
    if (opts.root) state.stack = [{ name: name, params: params }];
    else if (opts.replace) state.stack[state.stack.length - 1] = { name: name, params: params };
    else state.stack.push({ name: name, params: params });
    render();
  }
  function back() {
    if (state.stack.length > 1) { state.stack.pop(); render(); }
  }
  function refresh() { render(); }

  var ADMIN_TABS = [
    { name: "home", ico: "🏠", label: "Home" },
    { name: "resolutions", ico: "🗳", label: "Resolutions" },
    { name: "members", ico: "👥", label: "Members" },
    { name: "setup", ico: "⚙️", label: "Setup" },
  ];
  var MEMBER_TABS = [
    { name: "ballots", ico: "🗳", label: "Vote" },
    { name: "closed", ico: "📊", label: "Results" },
    { name: "me", ico: "👤", label: "Me" },
  ];
  function tabsFor() {
    if (!state.me) return [];
    if (state.me.role === "admin") return ADMIN_TABS;
    if (state.me.role === "member") return MEMBER_TABS;
    return [];
  }
  function renderTabs() {
    var tabs = tabsFor();
    var root = state.stack[0] && state.stack[0].name;
    var bar = h('<nav class="tabbar"></nav>');
    tabs.forEach(function (tab) {
      var b = h('<button class="tab' + (root === tab.name ? " on" : "") + '"><span class="ico">' + tab.ico + "</span>" + esc(t(tab.label)) + "</button>");
      b.onclick = function () { haptic("light"); go(tab.name, {}, { root: true }); };
      bar.append(b);
    });
    return bar;
  }

  /** Language switch: cycles through the available languages and re-renders. */
  function switchLanguage() {
    var langs = I18N.langs;
    var i = langs.indexOf(I18N.lang());
    I18N.setLang(langs[(i + 1) % langs.length]);
    document.documentElement.lang = I18N.lang();
    haptic("light");
    render();
  }

  async function render() {
    try { if (state.stack.length > 1) tg.BackButton.show(); else tg.BackButton.hide(); } catch (_) { /* ignore */ }
    var view = current();
    var def = views[view.name];
    var seq = ++state.renderSeq;
    var alive = function () { return seq === state.renderSeq; };

    app.innerHTML = "";
    var header = h('<header class="header"><h1>' + esc(def.title(view.params)) + "</h1></header>");
    if (def.action) {
      var act = def.action(view.params);
      if (act) {
        var btn = h('<button class="icon-btn">' + esc(act.label) + "</button>");
        btn.onclick = act.onClick;
        header.append(btn);
      }
    }
    if (view.name !== "help") {
      var helpBtn = h('<button class="icon-btn help-btn" aria-label="' + esc(t("Help")) + '" title="' + esc(t("Help")) + '">?</button>');
      helpBtn.onclick = function () { haptic("light"); go("help"); };
      header.append(helpBtn);
    }
    var langBtn = h('<button class="icon-btn lang-btn" aria-label="' + esc(t("Language")) + '">' + esc(I18N.nextLabel()) + "</button>");
    langBtn.onclick = switchLanguage;
    header.append(langBtn);

    var showTabs = tabsFor().length > 0;
    var content = h('<main class="content' + (showTabs ? "" : " no-tabs") + '"><div class="screen-center"><div class="spinner"></div></div></main>');
    app.append(header, content);
    if (showTabs) app.append(renderTabs());
    window.scrollTo(0, 0);

    try {
      await def.render(content, view.params, alive);
    } catch (err) {
      if (!alive()) return;
      content.innerHTML =
        '<div class="card"><h2>' + esc(t("Could not load")) + '</h2><p class="hint">' + esc(err.message) + "</p></div>" +
        '<button class="btn secondary block" data-retry>' + esc(t("Retry")) + "</button>";
      content.querySelector("[data-retry]").onclick = refresh;
    }
  }

  // ------------------------------------------------------------- sheets
  function openSheet(html, bind) {
    return new Promise(function (resolve) {
      var backdrop = h('<div class="sheet-backdrop"><div class="sheet"><div class="handle"></div>' + html + "</div></div>");
      var sheet = backdrop.firstElementChild;
      var done = false;
      function close(value) {
        if (done) return;
        done = true;
        backdrop.remove();
        resolve(value === undefined ? null : value);
      }
      backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(null); });
      document.body.append(backdrop);
      if (bind) bind(sheet, close);
    });
  }

  function groupTopics(topics) {
    var groups = {};
    topics.forEach(function (tp) {
      var key = String(tp.chat_id);
      if (!groups[key]) groups[key] = { chat_id: tp.chat_id, title: (tp.chat_title || t("Chat {id}", { id: tp.chat_id })) + (state.linkedChatId && tp.chat_id !== state.linkedChatId ? " · " + t("not the linked group") : ""), topics: [] };
      groups[key].topics.push(tp);
    });
    return Object.keys(groups).map(function (k) { return groups[k]; });
  }
  function topicName(tp) { return tp.name || (tp.thread_id === 0 ? t("General") : t("Topic #{id}", { id: tp.thread_id })); }
  /** Human label for a member permission the group lock controls. */
  function permLabel(key) {
    return { can_invite_users: t("add members"), can_change_info: t("change group info"), can_pin_messages: t("pin messages"), can_manage_topics: t("create topics"), can_send_polls: t("post polls") }[key] || key;
  }

  /** Let the admin choose a group topic. Resolves {chat_id, thread_id, name} or null. */
  function pickTopic(topics, title) {
    if (!topics || topics.length === 0) {
      return openSheet(
        "<h2>" + esc(title || t("Choose a topic")) + "</h2>" +
          '<p class="hint">' + esc(t("The bot has not seen any group topics yet. Add the bot to the assembly supergroup as an admin, then post any message in each topic — it will appear here. You can also add a topic by ID in Setup.")) + "</p>" +
          '<button class="btn secondary block" data-setup>' + esc(t("Go to Setup")) + "</button>",
        function (sheet, close) {
          sheet.querySelector("[data-setup]").onclick = function () { close(null); go("setup"); };
        }
      );
    }
    var html = "<h2>" + esc(title || t("Choose a topic")) + "</h2>";
    groupTopics(topics).forEach(function (g) {
      html += '<div class="section-title">' + esc(g.title) + '</div><div class="list">';
      g.topics.forEach(function (tp) {
        html += '<button class="row" data-chat="' + tp.chat_id + '" data-thread="' + tp.thread_id + '"><div class="main"><div class="title">' +
          esc(topicName(tp)) + '</div><div class="meta">' +
          esc(tp.thread_id === 0 ? t("General topic") : t("Topic ID {id}", { id: tp.thread_id })) + '</div></div><span class="chev">›</span></button>';
      });
      html += "</div>";
    });
    return openSheet(html, function (sheet, close) {
      on(sheet, "[data-chat]", "click", function (e) {
        var b = e.currentTarget;
        close({ chat_id: Number(b.dataset.chat), thread_id: Number(b.dataset.thread), name: b.querySelector(".title").textContent });
      });
    });
  }

  /** Deadline picker. Resolves {} (no deadline), {minutes}, {closes_at} or null (cancelled). */
  function pickDeadline(code) {
    var quick = [15, 30, 45, 60, 90, 120];
    var now = new Date(Date.now() + 5 * 60000);
    var pad = function (n) { return String(n).padStart(2, "0"); };
    var minLocal = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + "T" + pad(now.getHours()) + ":" + pad(now.getMinutes());
    var html =
      "<h2>" + esc(t("Open voting on {code}", { code: code })) + "</h2>" +
      '<p class="hint">' + esc(t("Members can vote as soon as voting opens. Choose when it should close.")) + "</p>" +
      '<button class="btn block" data-none>' + esc(t("Open without a deadline (close manually)")) + "</button>" +
      '<div class="section-title">' + esc(t("Close automatically after")) + "</div>" +
      '<div class="chips">' + quick.map(function (m) { return '<button class="chip" data-min="' + m + '">' + esc(m >= 60 ? t("{n} h", { n: m / 60 }) : t("{n} min", { n: m })) + "</button>"; }).join("") + "</div>" +
      '<div class="inline-fields"><div class="field"><label>' + esc(t("Custom minutes")) + '</label><input type="number" min="1" inputmode="numeric" data-custom placeholder="' + esc(t("e.g. 25")) + '"></div>' +
      '<div class="field"><label>&nbsp;</label><button class="btn secondary block" data-custom-go>' + esc(t("Open")) + "</button></div></div>" +
      '<div class="section-title">' + esc(t("Or close at a specific time")) + "</div>" +
      '<div class="field"><label>' + esc(t("Date and time (your device time)")) + '</label><input type="datetime-local" data-at min="' + minLocal + '"></div>' +
      '<button class="btn secondary block" data-at-go>' + esc(t("Open with this deadline")) + "</button>";
    return openSheet(html, function (sheet, close) {
      sheet.querySelector("[data-none]").onclick = function () { close({}); };
      on(sheet, "[data-min]", "click", function (e) { close({ minutes: Number(e.currentTarget.dataset.min) }); });
      sheet.querySelector("[data-custom-go]").onclick = function () {
        var m = Number(sheet.querySelector("[data-custom]").value);
        if (!m || m < 1) return toast(t("Enter the number of minutes"), "err");
        close({ minutes: Math.round(m) });
      };
      sheet.querySelector("[data-at-go]").onclick = function () {
        var v = sheet.querySelector("[data-at]").value;
        if (!v) return toast(t("Pick a date and time"), "err");
        var d = new Date(v);
        if (isNaN(d.getTime()) || d.getTime() < Date.now() + 60000) return toast(t("The deadline must be in the future"), "err");
        close({ closes_at: d.toISOString() });
      };
    });
  }

  /** Run a batched server job (broadcast, notify) with a progress sheet. */
  function runBatches(title, step) {
    return openSheet(
      "<h2>" + esc(title) + '</h2><p class="hint" data-status>' + esc(t("Starting…")) + '</p><div class="progress"><span data-bar style="width:0%"></span></div>',
      async function (sheet, close) {
        var offset = 0, sent = 0, failed = 0, total = 0;
        try {
          for (;;) {
            var r = await step(offset);
            sent += r.sent; failed += r.failed; total = r.total;
            var done = r.next_offset === null ? total : r.next_offset;
            sheet.querySelector("[data-status]").textContent = t("Sent {sent} of {total}", { sent: sent, total: total }) + (failed ? " " + t("({n} unreachable)", { n: failed }) : "");
            sheet.querySelector("[data-bar]").style.width = (total ? Math.round(done / total * 100) : 100) + "%";
            if (r.next_offset === null) break;
            offset = r.next_offset;
          }
          haptic("success");
          close({ sent: sent, failed: failed, total: total });
        } catch (err) {
          fail(err);
          close(null);
        }
      }
    );
  }

  // ------------------------------------------------------------- shared blocks
  function resolutionMeta(e) {
    var bits = [e.anonymous ? "🔒 " + t("Secret ballot") : "✏️ " + t("Open ballot"), thresholdLabel(e.threshold)];
    if (e.quorum) bits.push(t("Quorum {n}%", { n: e.quorum }));
    bits.push(plural(e.options.length, "option"));
    return bits.join(" · ");
  }

  function resultsHtml(e) {
    if (!e.counts) return "";
    var total = e.counts.reduce(function (a, b) { return a + b; }, 0);
    var max = Math.max.apply(null, e.counts.concat([1]));
    var o = e.outcome || {};
    var leaders = o.leaders || [];
    var html = '<p class="hint">' + esc(t("Ballots cast:")) + " <b>" + e.ballots + "</b>" + (total !== e.ballots ? " · " + esc(t("Votes counted:")) + " <b>" + total + "</b>" : "") +
      (e.quorum ? " · " + esc(t("Quorum {n}%", { n: e.quorum })) + (o.quorumRequired != null ? " (" + esc(t("{req} of {eligible} members", { req: o.quorumRequired, eligible: o.eligible })) + ")" : "") + ": " + (o.quorumMet ? "✅ " + esc(t("met")) : "❌ " + esc(t("not met"))) : "") +
      " · " + esc(t("To pass:")) + " " + esc(thresholdLabel(e.threshold)) + "</p>";
    e.options.forEach(function (opt, i) {
      var n = e.counts[i];
      var pct = total ? Math.round(n / total * 100) : 0;
      var lead = leaders.length === 1 && leaders[0] === opt && n > 0;
      html += '<div class="result' + (lead ? " lead" : "") + '"><div class="lbl"><span>' + esc(opt) + '</span><span class="n">' + n + " · " + pct + '%</span></div>' +
        '<div class="bar"><span style="width:' + Math.round(n / max * 100) + '%"></span></div></div>';
    });
    if (e.status === "closed") {
      if (total === 0) html += '<div class="verdict rejected">❌ ' + esc(t("No votes were cast.")) + "</div>";
      else if (!o.quorumMet) html += '<div class="verdict warn">⚠️ ' + esc(t("Quorum not reached — the vote is not valid.")) + "</div>";
      else if (o.adopted) html += '<div class="verdict adopted">✅ ' + esc(t("ADOPTED: {winner}", { winner: o.winner })) + "</div>";
      else if (o.winner) html += '<div class="verdict rejected">❌ ' + esc(t("Not adopted — “{winner}” leads but does not reach the required {threshold}.", { winner: o.winner, threshold: thresholdLabel(e.threshold) })) + "</div>";
      else html += '<div class="verdict warn">⚖️ ' + esc(t("Tie between {names} — not adopted.", { names: leaders.join(", ") })) + "</div>";
    } else if (leaders.length === 1) {
      html += '<p class="small">▶️ ' + esc(t("Leading:")) + " <b>" + esc(o.winner) + "</b> (" + esc(t("interim")) + ")</p>";
    } else if (leaders.length > 1) {
      html += '<p class="small">⚖️ ' + esc(t("Tie between {names}", { names: leaders.join(", ") })) + " (" + esc(t("interim")) + ")</p>";
    }
    return html;
  }

  function outcomeLabel(e) {
    if (e.outcome && e.outcome.adopted) return "✅ " + t("Adopted: {winner}", { winner: e.outcome.winner });
    if (e.outcome && !e.outcome.quorumMet) return "⚠️ " + t("Quorum not reached");
    return "❌ " + t("Not adopted");
  }

  function resolutionRow(e) {
    var meta = statusBadge(e.status) + " " + esc(e.anonymous ? t("secret") : t("open ballot")) + " · " + esc(plural(e.options.length, "option")) +
      (e.status !== "draft" ? " · " + esc(plural(e.ballots, "ballot")) : "");
    return '<button class="row" data-res="' + e.id + '"><div class="main"><div class="title">' + esc(e.code) + " — " + esc(e.title) +
      '</div><div class="meta">' + meta + '</div></div><span class="chev">›</span></button>';
  }

  // ===================================================================== VIEWS
  var views = {};

  // ---------------------------------------------------------------- ADMIN: home
  views.home = {
    title: function () { return t("ESA Voting — Admin"); },
    action: function () { return { label: "↻", onClick: refresh }; },
    render: async function (content, params, alive) {
      var d = await api("GET", "/dashboard");
      if (!alive()) return;
      var open = d.resolutions.filter(function (r) { return r.status === "open"; });
      var html =
        '<div class="kpis">' +
        '<div class="kpi"><div class="n">' + d.members.registered + '</div><div class="l">' + esc(t("registered of {n}", { n: d.members.total })) + "</div></div>" +
        '<div class="kpi"><div class="n">' + d.summary.open + '</div><div class="l">' + esc(t("open")) + "</div></div>" +
        '<div class="kpi"><div class="n">' + d.summary.closed + '</div><div class="l">' + esc(t("closed")) + "</div></div>" +
        "</div>";
      if (!d.group) {
        html += '<div class="card"><h3>⚠️ ' + esc(t("No assembly group linked")) + '</h3><p class="hint">' + esc(t("Add the bot to the assembly supergroup as an administrator. Announcements need a topic to post into.")) +
          '</p><button class="btn secondary sm" data-go="setup">' + esc(t("Open Setup")) + "</button></div>";
      }
      html += '<div class="section-title">' + esc(t("Open for voting")) + "</div>";
      html += open.length ? '<div class="list">' + open.map(resolutionRow).join("") + "</div>" :
        '<div class="card"><p class="empty">' + esc(t("Nothing is open right now.")) + "</p></div>";
      html += '<div class="section-title">' + esc(t("Quick actions")) + '</div><div class="actions">' +
        '<button class="btn block" data-go="resform">＋ ' + esc(t("New resolution")) + "</button>" +
        '<button class="btn secondary block" data-go="broadcast">📣 ' + esc(t("Message all members")) + "</button>" +
        '<button class="btn secondary block" data-go="report">📋 ' + esc(t("Assembly report")) + "</button>" +
        (state.me.member ? '<button class="btn secondary block" data-go="ballots">🗳 ' + esc(t("My ballot")) + "</button>" : "") +
        '<button class="btn secondary block" data-go="help">❔ ' + esc(t("Help and guides")) + "</button>" +
        "</div>";
      content.innerHTML = html;
      on(content, "[data-res]", "click", function (e) { go("resolution", { id: e.currentTarget.dataset.res }); });
      on(content, "[data-go]", "click", function (e) { go(e.currentTarget.dataset.go); });
    },
  };

  // ---------------------------------------------------------------- ADMIN: resolutions list
  var resFilter = "all";
  views.resolutions = {
    title: function () { return t("Resolutions"); },
    action: function () { return { label: "＋ " + t("New"), onClick: function () { go("resform"); } }; },
    render: async function (content, params, alive) {
      var d = await api("GET", "/resolutions");
      if (!alive()) return;
      var filters = [["all", "All"], ["draft", "Draft"], ["open", "Open"], ["closed", "Closed"]];
      var items = d.items.filter(function (r) { return resFilter === "all" || r.status === resFilter; });
      var html = '<div class="chips">' + filters.map(function (f) {
        var n = f[0] === "all" ? d.items.length : d.items.filter(function (r) { return r.status === f[0]; }).length;
        return '<button class="chip' + (resFilter === f[0] ? " on" : "") + '" data-f="' + f[0] + '">' + esc(t(f[1])) + " · " + n + "</button>";
      }).join("") + "</div>";
      html += items.length ? '<div class="list">' + items.map(resolutionRow).join("") + "</div>" :
        '<div class="card"><p class="empty">' + esc(d.items.length ? t("No resolutions in this state.") : t("No resolutions yet. Tap “＋ New” to create the first one.")) + "</p></div>";
      content.innerHTML = html;
      on(content, "[data-f]", "click", function (e) { resFilter = e.currentTarget.dataset.f; refresh(); });
      on(content, "[data-res]", "click", function (e) { go("resolution", { id: e.currentTarget.dataset.res }); });
    },
  };

  // ---------------------------------------------------------------- ADMIN: resolution detail
  views.resolution = {
    title: function () { return t("Resolution"); },
    action: function () { return { label: "↻", onClick: refresh }; },
    render: async function (content, params, alive) {
      var e = await api("GET", "/resolutions/" + params.id);
      if (!alive()) return;
      var html = '<div class="card"><h2>' + esc(e.code) + " — " + esc(e.title) + "</h2>" +
        "<div>" + statusBadge(e.status) + "</div>" +
        (e.description ? "<p>" + esc(e.description) + "</p>" : "") +
        '<p class="hint">' + esc(resolutionMeta(e)) + "</p>";
      var kv = [];
      if (e.opened_at_local) kv.push([t("Opened"), e.opened_at_local]);
      if (e.status === "open") kv.push([t("Closes"), e.closes_at_local || t("manually (no deadline)")]);
      if (e.closed_at_local) kv.push([t("Closed"), e.closed_at_local]);
      if (e.announce_chat_id) {
        var tp = e.topics.filter(function (x) { return x.chat_id === e.announce_chat_id && x.thread_id === (e.announce_thread_id || 0); })[0];
        kv.push([t("Announced in"), tp ? topicName(tp) : t("a group topic")]);
      }
      if (kv.length) html += '<dl class="kv">' + kv.map(function (p) { return "<dt>" + esc(p[0]) + "</dt><dd>" + esc(p[1]) + "</dd>"; }).join("") + "</dl>";
      html += "</div>";

      if (e.status === "draft") {
        html += '<div class="card"><h3>' + esc(t("Options")) + '</h3><ol style="margin:0;padding-left:20px">' + e.options.map(function (o) { return "<li>" + esc(o) + "</li>"; }).join("") + "</ol></div>";
        html += '<div class="actions">' +
          '<button class="btn block" data-act="open">🟢 ' + esc(t("Open voting")) + "</button>" +
          '<button class="btn secondary block" data-act="edit">✏️ ' + esc(t("Edit")) + "</button>" +
          '<button class="btn danger block" data-act="delete">🗑 ' + esc(t("Delete draft")) + "</button></div>";
      } else {
        html += '<div class="card"><h3>' + esc(e.status === "closed" ? t("Final results") : t("Interim results")) + "</h3>" + resultsHtml(e) + "</div>";
        if (e.status === "open") {
          html += '<div class="actions">' +
            '<button class="btn block" data-act="announce">📢 ' + esc(t("Announce in a topic")) + "</button>" +
            '<button class="btn secondary block" data-act="notify">📨 ' + esc(t("Send ballot to all members")) + "</button>" +
            '<button class="btn secondary block" data-act="publish">📊 ' + esc(t("Post interim results")) + "</button>" +
            '<button class="btn danger block" data-act="close">🔴 ' + esc(t("Close voting now")) + "</button></div>";
        } else {
          html += '<div class="actions"><button class="btn secondary block" data-act="publish">📊 ' + esc(t("Post final results to a topic")) + "</button>" +
            '<button class="btn secondary block" data-act="reopen">🔁 ' + esc(t("Reopen voting")) + "</button></div>";
        }
      }
      content.innerHTML = html;

      on(content, "[data-act]", "click", async function (ev) {
        var act = ev.currentTarget.dataset.act;
        haptic("light");
        try {
          if (act === "edit") return go("resform", { id: e.id });
          if (act === "delete") {
            if (!(await confirmDialog(t("Delete draft {code}? This cannot be undone.", { code: e.code })))) return;
            await api("DELETE", "/resolutions/" + e.id);
            toast(t("{code} deleted", { code: e.code }), "ok");
            return back();
          }
          if (act === "open") {
            var dl = await pickDeadline(e.code);
            if (dl === null) return;
            var r = await api("POST", "/resolutions/" + e.id + "/open", dl);
            haptic("success");
            toast(r.closes_at_local ? t("Voting is open until {time}", { time: r.closes_at_local }) : t("Voting is open"), "ok");
            if (await confirmDialog(t("Announce {code} in a group topic now?", { code: e.code }))) {
              var tpk = await pickTopic(e.topics, t("Announce {code} in…", { code: e.code }));
              if (tpk) { var a = await api("POST", "/resolutions/" + e.id + "/announce", tpk); toast(t("Posted to {to}", { to: a.posted_to }), "ok"); }
            }
            return refresh();
          }
          if (act === "announce" || act === "publish") {
            var topic = await pickTopic(e.topics, act === "announce" ? t("Announce {code} in…", { code: e.code }) : t("Post results to…"));
            if (!topic) return;
            var res = await api("POST", "/resolutions/" + e.id + "/" + act, topic);
            haptic("success");
            toast(t("Posted to {to}", { to: res.posted_to }), "ok");
            return refresh();
          }
          if (act === "notify") {
            if (!(await confirmDialog(t("Send the {code} ballot as a private message to every registered member?", { code: e.code })))) return;
            var out = await runBatches(t("Sending ballot…"), function (offset) { return api("POST", "/resolutions/" + e.id + "/notify", { offset: offset }); });
            if (out) await alertDialog(t("Ballot delivered to {sent} of {total} members.", { sent: out.sent, total: out.total }) + (out.failed ? " " + t("{n} could not be reached (they must open the bot first).", { n: out.failed }) : ""));
            return;
          }
          if (act === "reopen") {
            if (!(await confirmDialog(t("Reopen voting on {code}? Ballots already cast are kept; members who have not voted yet can vote until it closes again, and the results are published again then.", { code: e.code })))) return;
            var rdl = await pickDeadline(e.code);
            if (rdl === null) return;
            var rr = await api("POST", "/resolutions/" + e.id + "/reopen", rdl);
            haptic("success");
            toast(rr.closes_at_local ? t("Voting is open again until {time}", { time: rr.closes_at_local }) : t("Voting is open again"), "ok");
            return refresh();
          }
          if (act === "close") {
            if (!(await confirmDialog(t("Close voting on {code} now? Final results will be published", { code: e.code }) + (e.announce_chat_id ? " " + t("to the announcement topic.") : ".")))) return;
            await api("POST", "/resolutions/" + e.id + "/close");
            haptic("success");
            toast(t("Voting closed"), "ok");
            return refresh();
          }
        } catch (err) { fail(err); }
      });
    },
  };

  // ---------------------------------------------------------------- ADMIN: new / edit resolution
  views.resform = {
    title: function (p) { return p.id ? t("Edit resolution") : t("New resolution"); },
    render: async function (content, params, alive) {
      var e = params.id ? await api("GET", "/resolutions/" + params.id) : null;
      if (!alive()) return;
      if (e && e.status !== "draft") { content.innerHTML = '<div class="card"><p>' + esc(t("Only drafts can be edited.")) + "</p></div>"; return; }
      var options = e ? e.options.slice() : ["", ""];
      var html = '<div class="card">' +
        '<div class="field"><label>' + esc(t("Title *")) + '</label><input type="text" data-f="title" maxlength="200" placeholder="' + esc(t("e.g. Host city for JOTA-JOTI 2026")) + '" value="' + esc(e ? e.title : "") + '"></div>' +
        '<div class="field"><label>' + esc(t("Description (optional)")) + '</label><textarea data-f="description" maxlength="2000" placeholder="' + esc(t("Shown to members on the ballot")) + '">' + esc(e ? e.description || "" : "") + "</textarea></div>" +
        "</div>" +
        '<div class="card"><h3>' + esc(t("Options *")) + '</h3><div data-options></div>' +
        '<div class="actions inline"><button class="btn secondary sm" data-add>＋ ' + esc(t("Add option")) + '</button><button class="btn secondary sm" data-abstain>＋ ' + esc(t("Abstain")) + "</button></div>" +
        '<p class="hint">' + esc(t("2–12 options. An option named “Abstain” counts toward quorum but not toward the majority.")) + "</p></div>" +
        '<div class="card">' +
        '<label class="switch"><span class="lbl"><span>' + esc(t("Secret ballot")) + '</span><span class="hint">' + esc(t("Choices are stored anonymously and are final")) + '</span></span><input type="checkbox" data-f="anonymous"' + (!e || e.anonymous ? " checked" : "") + "></label>" +
        '<div class="inline-fields">' +
        '<div class="field"><label>' + esc(t("Quorum (% of members)")) + '</label><input type="number" min="1" max="100" inputmode="numeric" data-f="quorum" placeholder="' + esc(t("none")) + '" value="' + (e && e.quorum ? e.quorum : "") + '"></div>' +
        '<div class="field"><label>' + esc(t("Majority to adopt")) + '</label><select data-f="threshold"><option value="simple"' + (!e || e.threshold === "simple" ? " selected" : "") + ">" + esc(t("Simple majority")) + '</option><option value="two_thirds"' + (e && e.threshold === "two_thirds" ? " selected" : "") + ">" + esc(t("2/3 majority")) + "</option></select></div>" +
        "</div></div>" +
        '<button class="btn block" data-save>' + esc(e ? t("Save changes") : t("Create draft")) + "</button>";
      content.innerHTML = html;

      var optBox = content.querySelector("[data-options]");
      function drawOptions() {
        optBox.innerHTML = options.map(function (o, i) {
          return '<div class="option-row"><input type="text" maxlength="60" placeholder="' + esc(t("Option {n}", { n: i + 1 })) + '" data-opt="' + i + '" value="' + esc(o) + '">' +
            (options.length > 2 ? '<button class="x" data-rm="' + i + '" aria-label="' + esc(t("Remove")) + '">×</button>' : "") + "</div>";
        }).join("");
        on(optBox, "[data-opt]", "input", function (ev) { options[Number(ev.target.dataset.opt)] = ev.target.value; });
        on(optBox, "[data-rm]", "click", function (ev) { options.splice(Number(ev.currentTarget.dataset.rm), 1); drawOptions(); });
      }
      drawOptions();
      content.querySelector("[data-add]").onclick = function () { if (options.length >= 12) return toast(t("At most 12 options"), "err"); options.push(""); drawOptions(); optBox.querySelector("[data-opt='" + (options.length - 1) + "']").focus(); };
      content.querySelector("[data-abstain]").onclick = function () { if (options.some(function (o) { return /^abstain/i.test(o.trim()); })) return toast(t("Already has an Abstain option")); options.push("Abstain"); drawOptions(); };
      content.querySelector("[data-save]").onclick = async function () {
        var f = function (name) { return content.querySelector("[data-f='" + name + "']"); };
        var body = {
          title: f("title").value.trim(),
          description: f("description").value.trim() || null,
          options: options.map(function (o) { return o.trim(); }).filter(Boolean),
          anonymous: f("anonymous").checked,
          quorum: f("quorum").value ? Number(f("quorum").value) : null,
          threshold: f("threshold").value,
        };
        if (body.title.length < 3) return toast(t("Please enter a title"), "err");
        if (body.options.length < 2) return toast(t("At least two options are required"), "err");
        this.disabled = true;
        try {
          var r = e ? await api("PATCH", "/resolutions/" + e.id, body) : await api("POST", "/resolutions", body);
          haptic("success");
          toast(e ? t("Saved") : t("{code} created as a draft", { code: r.code }), "ok");
          state.stack.pop();
          if (e) refresh(); else go("resolution", { id: r.id });
        } catch (err) { this.disabled = false; fail(err); }
      };
    },
  };

  // ---------------------------------------------------------------- ADMIN: members
  var memQ = "", memFilter = "all";
  views.members = {
    title: function () { return t("Members"); },
    action: function () { return { label: "＋ " + t("Invitations"), onClick: function () { go("councils"); } }; },
    render: async function (content, params, alive) {
      var page = 0;
      var d = await api("GET", "/members?q=" + encodeURIComponent(memQ) + "&filter=" + memFilter + "&page=0");
      if (!alive()) return;
      var filters = [["all", "All"], ["registered", "Registered"], ["unregistered", "Not registered"], ["locked", "Locked"], ["inactive", "Deactivated"]];
      content.innerHTML =
        '<div class="kpis"><div class="kpi"><div class="n">' + d.counts.total + '</div><div class="l">' + esc(t("tokens issued")) + "</div></div>" +
        '<div class="kpi"><div class="n">' + d.counts.registered + '</div><div class="l">' + esc(t("registered")) + "</div></div>" +
        '<div class="kpi"><div class="n">' + (d.counts.total - d.counts.active) + '</div><div class="l">' + esc(t("deactivated")) + "</div></div></div>" +
        '<div class="field"><input type="text" data-q placeholder="' + esc(t("Search token, name or region")) + '" value="' + esc(memQ) + '"></div>' +
        '<div class="chips">' + filters.map(function (f) { return '<button class="chip' + (memFilter === f[0] ? " on" : "") + '" data-f="' + f[0] + '">' + esc(t(f[1])) + "</button>"; }).join("") + "</div>" +
        '<p class="hint" data-total>' + esc(plural(d.total, "member")) + "</p>" +
        '<div class="list" data-list></div>' +
        '<button class="btn secondary block" data-more hidden>' + esc(t("Load more")) + "</button>";
      var list = content.querySelector("[data-list]");
      var more = content.querySelector("[data-more]");

      function memberRow(m) {
        var badges = (m.telegram_user_id ? '<span class="badge ok">' + esc(t("registered")) + "</span>" : '<span class="badge">' + esc(t("not registered")) + "</span>") +
          (m.locked ? ' <span class="badge warn">' + esc(t("locked")) + "</span>" : "") + (!m.is_active ? ' <span class="badge err">' + esc(t("deactivated")) + "</span>" : "");
        return '<button class="row" data-m="' + m.id + '"><div class="main"><div class="title">' + esc(m.full_name || m.token_id) + '</div><div class="meta"><code>' + esc(m.token_id) + "</code>" +
          (m.region ? " · " + esc(m.region) : "") + "</div><div>" + badges + '</div></div><span class="chev">›</span></button>';
      }
      var shown = [];
      function append(items) {
        items.forEach(function (m) { shown.push(m); list.insertAdjacentHTML("beforeend", memberRow(m)); });
        more.hidden = shown.length >= d.total;
        if (!d.total) list.innerHTML = '<p class="empty">' + esc(t("No members match.")) + "</p>";
      }
      append(d.items);
      list.addEventListener("click", async function (ev) {
        var row = ev.target.closest("[data-m]");
        if (!row) return;
        var m = shown.filter(function (x) { return x.id === row.dataset.m; })[0];
        if (!m) return;
        var html = "<h2>" + esc(m.full_name || m.token_id) + '</h2><dl class="kv"><dt>' + esc(t("Token")) + "</dt><dd><code>" + esc(m.token_id) + "</code></dd>" +
          (m.region ? "<dt>" + esc(t("Region")) + "</dt><dd>" + esc(m.region) + "</dd>" : "") +
          "<dt>" + esc(t("Status")) + "</dt><dd>" + esc(m.telegram_user_id ? t("Registered") + " " + (m.registered_at ? fmtDate(m.registered_at) : "") : t("Not registered yet")) + "</dd>" +
          (m.locked ? "<dt>" + esc(t("Lock")) + "</dt><dd>" + esc(t("Locked until {time}", { time: fmtTime(m.locked_until) })) + "</dd>" : "") + "</dl>" +
          '<div class="actions">' +
          (m.telegram_user_id ? '<button class="btn secondary block" data-a="unbind">🔓 ' + esc(t("Detach Telegram account (lost phone)")) + "</button>" : "") +
          (m.locked ? '<button class="btn secondary block" data-a="unlock">🔑 ' + esc(t("Unlock now")) + "</button>" : "") +
          (m.is_active ? '<button class="btn danger block" data-a="deactivate">🚫 ' + esc(t("Deactivate token")) + "</button>" : '<button class="btn block" data-a="activate">✅ ' + esc(t("Reactivate token")) + "</button>") +
          "</div>";
        var a = await openSheet(html, function (sheet, close) { on(sheet, "[data-a]", "click", function (e2) { close(e2.currentTarget.dataset.a); }); });
        if (!a) return;
        try {
          if (a === "unbind") {
            if (!(await confirmDialog(t("Detach {token} from its Telegram account? The member can then register again with the same credentials.", { token: m.token_id })))) return;
            await api("POST", "/members/" + m.id + "/unbind");
          } else if (a === "unlock") {
            await api("POST", "/members/" + m.id + "/unlock");
          } else if (a === "deactivate") {
            if (!(await confirmDialog(t("Deactivate {token}? The member will not be able to register or vote until reactivated.", { token: m.token_id })))) return;
            await api("POST", "/members/" + m.id + "/active", { active: false });
          } else if (a === "activate") {
            await api("POST", "/members/" + m.id + "/active", { active: true });
          }
          haptic("success"); toast(t("Done"), "ok"); refresh();
        } catch (err) { fail(err); }
      });
      more.onclick = async function () {
        page++;
        more.disabled = true;
        try {
          var d2 = await api("GET", "/members?q=" + encodeURIComponent(memQ) + "&filter=" + memFilter + "&page=" + page);
          append(d2.items);
        } catch (err) { fail(err); } finally { more.disabled = false; }
      };
      var q = content.querySelector("[data-q]");
      var timer;
      q.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { memQ = q.value; refresh(); }, 350); });
      on(content, "[data-f]", "click", function (e) { memFilter = e.currentTarget.dataset.f; refresh(); });
    },
  };

  // ---------------------------------------------------------------- ADMIN: generate credentials
  views.generate = {
    title: function () { return t("Quick credentials"); },
    render: async function (content) {
      content.innerHTML =
        '<div class="card"><p class="hint">' + esc(t("Creates a Token ID + password for each member and stores only a hash.")) + " " +
        t("The plaintext list is sent to <b>your</b> Telegram chat as a CSV — the only copy. Distribute it securely, then delete the file.") + "</p></div>" +
        '<div class="card"><div class="chips"><button class="chip on" data-mode="names">' + esc(t("By names")) + '</button><button class="chip" data-mode="count">' + esc(t("By count")) + "</button></div>" +
        '<div class="field" data-names-box><label>' + esc(t("One member per line: Full Name, Region")) + '</label><textarea data-names rows="8" placeholder="' + esc(t("Abebe Kebede, Addis Ababa\nSara Tesfaye, Oromia")) + '"></textarea></div>' +
        '<div class="field" data-count-box hidden><label>' + esc(t("Number of anonymous tokens")) + '</label><input type="number" min="1" max="2000" inputmode="numeric" data-count value="10"></div>' +
        '<div class="field"><label>' + esc(t("Token prefix")) + '</label><input type="text" data-prefix value="ESA-2026" maxlength="20"></div></div>' +
        '<button class="btn block" data-gen>' + esc(t("Generate")) + "</button>" +
        '<div data-out></div>';
      var mode = "names";
      on(content, "[data-mode]", "click", function (e) {
        mode = e.currentTarget.dataset.mode;
        content.querySelectorAll("[data-mode]").forEach(function (c) { c.classList.toggle("on", c.dataset.mode === mode); });
        content.querySelector("[data-names-box]").hidden = mode !== "names";
        content.querySelector("[data-count-box]").hidden = mode !== "count";
      });
      function credsTable(rows) {
        return '<table class="creds"><tr><th>' + esc(t("Token")) + "</th><th>" + esc(t("Password")) + "</th><th>" + esc(t("Name")) + "</th></tr>" +
          rows.map(function (x) { return "<tr><td><code>" + esc(x.token_id) + "</code></td><td><code>" + esc(x.password) + "</code></td><td>" + esc(x.full_name || "") + "</td></tr>"; }).join("") + "</table>";
      }
      content.querySelector("[data-gen]").onclick = async function () {
        var prefix = content.querySelector("[data-prefix]").value.trim() || "ESA-2026";
        var people;
        if (mode === "names") {
          people = content.querySelector("[data-names]").value.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
            var parts = l.split(",").map(function (s) { return s.trim(); });
            return { name: parts[0] || null, region: parts[1] || null };
          });
        } else {
          var n = Number(content.querySelector("[data-count]").value);
          if (!n || n < 1 || n > 2000) return toast(t("Enter a count between 1 and 2000"), "err");
          people = []; for (var i = 0; i < n; i++) people.push({ name: null, region: null });
        }
        if (!people.length) return toast(t("Add at least one member"), "err");
        if (!(await confirmDialog(t("Generate {count} with prefix {prefix}?", { count: plural(people.length, "credential"), prefix: prefix })))) return;
        var btn = this; btn.disabled = true;
        var out = content.querySelector("[data-out]");
        out.innerHTML = '<div class="card"><p class="hint" data-st>' + esc(t("Generating…")) + '</p><div class="progress"><span data-bar style="width:0%"></span></div></div>';
        var rows = [];
        try {
          for (var off = 0; off < people.length; off += 40) {
            var r = await api("POST", "/members/generate", { people: people.slice(off, off + 40), prefix: prefix });
            rows = rows.concat(r.rows);
            out.querySelector("[data-st]").textContent = t("Generated {done} of {total}…", { done: rows.length, total: people.length });
            out.querySelector("[data-bar]").style.width = Math.round(rows.length / people.length * 100) + "%";
          }
          out.querySelector("[data-st]").textContent = t("Sending the CSV to your chat…");
          await api("POST", "/members/credentials-file", { rows: rows });
          haptic("success");
          out.innerHTML = '<div class="card"><h3>✅ ' + esc(t("{count} created", { count: plural(rows.length, "credential") })) + "</h3>" +
            '<p class="hint">' + esc(t("The CSV with the passwords was sent to your private chat with the bot. Delete it from the chat once distributed.")) + "</p>" +
            "<details><summary>" + esc(t("Show credentials here")) + "</summary>" + credsTable(rows) + "</details></div>";
        } catch (err) {
          fail(err);
          if (rows.length) out.innerHTML += '<div class="card"><p class="danger-text">' + esc(t("{n} credentials were created before the error. Their passwords are shown below — copy them now.", { n: rows.length })) + "</p>" + credsTable(rows) + "</div>";
        } finally { btn.disabled = false; }
      };
    },
  };


  // ---------------------------------------------------------------- ADMIN: councils & invitations
  function councilMeta(c) {
    return t("{issued} of {seats} invitations issued · {registered} registered", { issued: c.issued, seats: c.seats, registered: c.registered }) +
      (c.vote_weight > 1 ? " · " + t("{n} votes each", { n: c.vote_weight }) : "");
  }
  function splitNames(text) {
    return String(text || "").split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  }
  /** Issue invitations for one council in batches of 40. names: array of strings (empty string = anonymous seat). */
  async function issueForCouncil(councilId, names, onProgress) {
    var rows = [];
    for (var off = 0; off < names.length; off += 40) {
      var r = await api("POST", "/councils/" + councilId + "/invitations", { names: names.slice(off, off + 40) });
      rows = rows.concat(r.rows);
      if (onProgress) onProgress(rows.length, names.length);
    }
    return rows;
  }
  function credsTable(rows) {
    return '<table class="creds"><tr><th>#</th><th>' + esc(t("Code")) + "</th><th>" + esc(t("Password")) + "</th><th>" + esc(t("Name")) + "</th></tr>" +
      rows.map(function (x) { return "<tr><td>" + (x.seat_no || "") + "</td><td><code>" + esc(x.token_id) + "</code></td><td><code>" + esc(x.password) + "</code></td><td>" + esc(x.full_name || "") + "</td></tr>"; }).join("") + "</table>";
  }
  /** Sheet to add a council (name, seats, optional delegate names). Resolves {name, seats, names} or null. */
  function councilSheet(existing) {
    var e = existing || {};
    return openSheet("<h2>" + esc(e.id ? t("Edit council") : t("Add council")) + "</h2>" +
      '<div class="field"><label>' + esc(t("Council name")) + '</label><input type="text" data-name maxlength="120" placeholder="' + esc(t("e.g. Addis Ababa Regional Council")) + '" value="' + esc(e.name || "") + '"></div>' +
      '<div class="inline-fields"><div class="field"><label>' + esc(t("Number of voting delegates (seats)")) + '</label><input type="number" min="1" max="1000" inputmode="numeric" data-seats value="' + (e.seats || 1) + '"></div>' +
      '<div class="field"><label>' + esc(t("Votes per delegate (vote weight)")) + '</label><input type="number" min="1" max="100" inputmode="numeric" data-weight value="' + (e.vote_weight || 1) + '"></div></div>' +
      '<p class="hint">' + esc(t("Total votes = delegates × votes per delegate. Example: 6 delegates × 1 vote and 3 delegates × 2 votes both carry 6 votes.")) + "</p>" +
      (e.id ? "" : '<div class="field"><label>' + esc(t("Delegate names, one per line (optional — leave empty for anonymous invitations)")) + '</label><textarea data-names rows="5" placeholder="' + esc(t("Abebe Kebede\nSara Tesfaye")) + '"></textarea></div>') +
      '<button class="btn block" data-ok>' + esc(e.id ? t("Save changes") : t("Create council")) + "</button>",
      function (sheet, close) {
        sheet.querySelector("[data-ok]").onclick = function () {
          var names = e.id ? [] : splitNames(sheet.querySelector("[data-names]").value);
          var seats = Number(sheet.querySelector("[data-seats]").value) || 0;
          var weight = Number(sheet.querySelector("[data-weight]").value) || 0;
          close({ name: sheet.querySelector("[data-name]").value.trim(), seats: Math.max(seats, names.length), vote_weight: weight, names: names });
        };
      });
  }

  views.councils = {
    title: function () { return t("Councils & invitations"); },
    action: function () { return { label: "↻", onClick: refresh }; },
    render: async function (content, params, alive) {
      var d = await api("GET", "/councils");
      if (!alive()) return;
      var html = '<div class="card"><p class="small">' + esc(t("Each council receives a number of voting invitations: one invitation code and password per delegate, with a QR code and link, delivered as a printable PDF. The council hands an invitation to each of its chosen members, who register by scanning the code and entering the password.")) + "</p></div>" +
        '<div class="actions"><button class="btn block" data-act="add">＋ ' + esc(t("Add council")) + "</button>" +
        '<button class="btn secondary block" data-act="import">📄 ' + esc(t("Import councils from Excel / CSV")) + "</button>" +
        '<button class="btn secondary block" data-act="quick">🎫 ' + esc(t("Quick credentials (no council)")) + "</button></div>";
      html += '<div class="section-title">' + esc(t("Councils")) + "</div>";
      html += d.items.length ? '<div class="list">' + d.items.map(function (c) {
        return '<button class="row" data-c="' + c.id + '"><div class="main"><div class="title">' + esc(c.name) + ' <span class="badge">' + esc(c.code) + '</span></div><div class="meta">' + esc(councilMeta(c)) + '</div></div><span class="chev">›</span></button>';
      }).join("") + "</div>" : '<div class="card"><p class="empty">' + esc(t("No councils yet. Add one or import a spreadsheet.")) + "</p></div>";
      content.innerHTML = html;
      on(content, "[data-c]", "click", function (e) { go("council", { id: e.currentTarget.dataset.c }); });
      on(content, "[data-act]", "click", async function (e) {
        var act = e.currentTarget.dataset.act;
        if (act === "import") return go("councilImport");
        if (act === "quick") return go("generate");
        var v = await councilSheet(null);
        if (!v) return;
        if (v.name.length < 2) return toast(t("Enter a council name"), "err");
        if (!v.seats) return toast(t("Enter the number of seats"), "err");
        if (!v.vote_weight) return toast(t("Enter the votes per delegate (1 or more)"), "err");
        try {
          var r = await api("POST", "/councils", { name: v.name, seats: v.seats, vote_weight: v.vote_weight });
          haptic("success");
          if (!v.names.length) { toast(t("Council created"), "ok"); return go("council", { id: r.council.id }); }
          toast(t("Council created — issuing invitations…"));
          var rows = await issueForCouncil(r.council.id, v.names);
          go("council", { id: r.council.id, rows: rows });
        } catch (err) { fail(err); }
      });
    },
  };

  views.council = {
    title: function () { return t("Council"); },
    action: function () { return { label: "↻", onClick: refresh }; },
    render: async function (content, params, alive) {
      var d = await api("GET", "/councils/" + params.id);
      if (!alive()) return;
      var c = d.council;
      var html = '<div class="card"><h2>' + esc(c.name) + ' <span class="badge">' + esc(c.code) + "</span></h2>" +
        '<dl class="kv"><dt>' + esc(t("Seats")) + "</dt><dd>" + c.seats + "</dd><dt>" + esc(t("Votes per delegate")) + "</dt><dd>" + c.vote_weight + "</dd><dt>" + esc(t("Total votes")) + "</dt><dd>" + c.total_votes + "</dd><dt>" + esc(t("Issued")) + "</dt><dd>" + c.issued + "</dd><dt>" + esc(t("Registered")) + "</dt><dd>" + c.registered + "</dd></dl>" +
        '<p class="hint">' + esc(t("Invitation codes start with {code}-. Registered delegates appear under Members as well.", { code: c.code })) + "</p>" +
        '<div class="actions inline"><button class="btn secondary sm" data-act="edit">✏️ ' + esc(t("Edit")) + "</button>" +
        (c.issued === 0 ? '<button class="btn danger sm" data-act="delete">🗑 ' + esc(t("Delete")) + "</button>" : "") + "</div></div>";
      if (params.rows && params.rows.length) {
        html += '<div class="card"><h3>✅ ' + esc(t("{n} new invitations", { n: params.rows.length })) + "</h3>" +
          '<p class="hint">' + esc(t("The passwords exist only here until you send the file. Send the PDF to your chat now, then print it or forward it to the council.")) + "</p>" +
          '<div class="actions"><button class="btn block" data-act="pdf">📄 ' + esc(t("Send printable PDF to my chat")) + "</button>" +
          '<button class="btn secondary block" data-act="csv">📎 ' + esc(t("Send CSV to my chat")) + "</button></div>" +
          "<details><summary>" + esc(t("Show codes here")) + "</summary>" + credsTable(params.rows) + "</details></div>";
      }
      html += '<div class="actions"><button class="btn block" data-act="add">＋ ' + esc(t("Add delegates")) + "</button>" +
        (c.issued > c.registered ? '<button class="btn secondary block" data-act="reissue">🔁 ' + esc(t("New passwords for unregistered delegates (lost sheet)")) + "</button>" : "") + "</div>";
      html += '<div class="section-title">' + esc(t("Invitations")) + "</div>";
      html += d.invitations.length ? '<div class="list">' + d.invitations.map(function (m) {
        var badge = m.telegram_user_id ? '<span class="badge ok">' + esc(t("registered")) + "</span>" : '<span class="badge">' + esc(t("not registered")) + "</span>";
        if (!m.is_active) badge += ' <span class="badge err">' + esc(t("deactivated")) + "</span>";
        if (m.locked) badge += ' <span class="badge warn">' + esc(t("locked")) + "</span>";
        return '<button class="row" data-m="' + m.id + '"><div class="main"><div class="title">' + (m.seat_no ? m.seat_no + ". " : "") + esc(m.full_name || t("Delegate {n}", { n: m.seat_no || "" })) + '</div><div class="meta"><code>' + esc(m.token_id) + "</code> " + badge + '</div></div><span class="chev">›</span></button>';
      }).join("") + "</div>" : '<div class="card"><p class="empty">' + esc(t("No invitations issued yet.")) + "</p></div>";
      content.innerHTML = html;

      on(content, "[data-m]", "click", async function (e) {
        var m = d.invitations.filter(function (x) { return x.id === e.currentTarget.dataset.m; })[0];
        if (!m) return;
        await openSheet("<h2>" + esc(m.full_name || t("Delegate {n}", { n: m.seat_no || "" })) + '</h2><dl class="kv"><dt>' + esc(t("Code")) + "</dt><dd><code>" + esc(m.token_id) + "</code></dd><dt>" + esc(t("Link")) + '</dt><dd><a href="' + esc(m.link) + '" target="_blank">' + esc(m.link) + "</a></dd><dt>" + esc(t("Status")) + "</dt><dd>" + esc(m.telegram_user_id ? t("Registered") : t("Not registered yet")) + "</dd></dl>" +
          '<p class="hint">' + esc(t("Unlock, detach or deactivate this delegate under Members.")) + "</p>", function (sheet, close) { /* read-only */ });
      });
      on(content, "[data-act]", "click", async function (e) {
        var act = e.currentTarget.dataset.act;
        try {
          if (act === "edit") {
            var v = await councilSheet(c);
            if (!v) return;
            if (v.name.length < 2) return toast(t("Enter a council name"), "err");
            if (!v.vote_weight) return toast(t("Enter the votes per delegate (1 or more)"), "err");
            await api("PATCH", "/councils/" + c.id, { name: v.name, seats: v.seats, vote_weight: v.vote_weight });
            haptic("success"); toast(t("Saved"), "ok"); return refresh();
          }
          if (act === "delete") {
            if (!(await confirmDialog(t("Delete council {name}?", { name: c.name })))) return;
            await api("DELETE", "/councils/" + c.id);
            toast(t("Council deleted"), "ok"); return back();
          }
          if (act === "add") {
            var a = await openSheet("<h2>" + esc(t("Add delegates")) + "</h2>" +
              '<div class="field"><label>' + esc(t("Delegate names, one per line")) + '</label><textarea data-names rows="6" placeholder="' + esc(t("Abebe Kebede\nSara Tesfaye")) + '"></textarea></div>' +
              '<div class="field"><label>' + esc(t("Or number of anonymous invitations")) + '</label><input type="number" min="1" max="1000" inputmode="numeric" data-count placeholder="' + esc(t("e.g. 5")) + '"></div>' +
              '<button class="btn block" data-ok>' + esc(t("Issue invitations")) + "</button>",
              function (sheet, close) { sheet.querySelector("[data-ok]").onclick = function () { close({ names: splitNames(sheet.querySelector("[data-names]").value), count: Number(sheet.querySelector("[data-count]").value) || 0 }); }; });
            if (!a) return;
            var names = a.names.length ? a.names : Array.apply(null, Array(a.count)).map(function () { return ""; });
            if (!names.length) return toast(t("Add at least one delegate"), "err");
            if (!(await confirmDialog(t("Issue {n} invitations for {name}?", { n: names.length, name: c.name })))) return;
            toast(t("Issuing invitations…"));
            var rows = await issueForCouncil(c.id, names);
            haptic("success");
            params.rows = rows; return refresh();
          }
          if (act === "reissue") {
            if (!(await confirmDialog(t("Give every unregistered delegate of {name} a new password? The old invitations stop working.", { name: c.name })))) return;
            var rr = await api("POST", "/councils/" + c.id + "/reissue");
            haptic("success");
            params.rows = rr.rows; toast(t("{n} passwords renewed", { n: rr.rows.length }), "ok"); return refresh();
          }
          if (act === "pdf") {
            e.currentTarget.disabled = true;
            await api("POST", "/councils/" + c.id + "/invitations-pdf", { rows: params.rows });
            haptic("success"); toast(t("PDF sent to your chat"), "ok"); e.currentTarget.disabled = false; return;
          }
          if (act === "csv") {
            await api("POST", "/members/credentials-file", { rows: params.rows.map(function (r) { return { token_id: r.token_id, password: r.password, full_name: r.full_name, region: c.name }; }) });
            haptic("success"); toast(t("CSV sent to your chat"), "ok"); return;
          }
        } catch (err) { fail(err); }
      });
    },
  };

  // ---------------------------------------------------------------- ADMIN: import councils from a spreadsheet
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) return resolve();
      var sc = document.createElement("script"); sc.src = src; sc.onload = resolve; sc.onerror = function () { reject(new Error(t("Could not load the spreadsheet reader. Paste the rows as text instead."))); };
      document.head.append(sc);
    });
  }
  function parseCsvText(text) {
    return String(text || "").split(/\r?\n/).filter(function (l) { return l.trim(); }).map(function (line) {
      var out = [], cur = "", q = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
        else if (ch === '"') q = true;
        else if (ch === "," || ch === ";" || ch === "\t") { out.push(cur); cur = ""; }
        else cur += ch;
      }
      out.push(cur);
      return out.map(function (x) { return x.trim(); });
    });
  }
  /** Rows (arrays) → plan [{name, seats, names[]}]. Header row with "council" is optional; columns: Council, Name, Seats. */
  function planFromRows(rows) {
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return String(h || "").trim().toLowerCase(); });
    var ci = 0, ni = 1, si = 2, wi = 3;
    if (head.some(function (h) { return /council|region|ም/.test(h); })) {
      ci = head.findIndex(function (h) { return /council|region/.test(h); }); if (ci < 0) ci = 0;
      ni = head.findIndex(function (h) { return /^(name|delegate|member|full)/.test(h); });
      wi = head.findIndex(function (h) { return /weight|per delegate|votes each/.test(h); });
      si = head.findIndex(function (h, k) { return k !== wi && /seat|vote|delegates|count|number/.test(h); });
      rows = rows.slice(1);
    }
    var plan = {}, order = [];
    rows.forEach(function (r) {
      var council = String(r[ci] || "").trim();
      if (!council) return;
      var name = ni >= 0 ? String(r[ni] || "").trim() : "";
      var seats = si >= 0 ? Number(String(r[si] || "").replace(/[^0-9]/g, "")) || 0 : 0;
      var weight = wi >= 0 ? Number(String(r[wi] || "").replace(/[^0-9]/g, "")) || 0 : 0;
      var key = council.toLowerCase();
      if (!plan[key]) { plan[key] = { name: council, seats: 0, vote_weight: 1, names: [] }; order.push(key); }
      if (name) plan[key].names.push(name);
      if (seats > plan[key].seats) plan[key].seats = seats;
      if (weight > plan[key].vote_weight) plan[key].vote_weight = weight;
    });
    return order.map(function (k) { var p = plan[k]; p.seats = Math.max(p.seats, p.names.length, 1); return p; });
  }

  views.councilImport = {
    title: function () { return t("Import councils"); },
    render: async function (content) {
      var plan = [];
      content.innerHTML = '<div class="card"><p class="small">' + esc(t("Upload an Excel (.xlsx) or CSV file, or paste rows below. One row per delegate, or one row per council with the number of seats. An optional last column gives the votes per delegate (default 1):")) + "</p>" +
        '<table class="creds"><tr><th>Council</th><th>Name</th><th>Seats</th><th>Votes each</th></tr><tr><td>Addis Ababa</td><td>Abebe Kebede</td><td></td><td></td></tr><tr><td>Addis Ababa</td><td>Sara Tesfaye</td><td></td><td></td></tr><tr><td>Oromia</td><td></td><td>3</td><td>2</td></tr></table>' +
        '<p class="hint">' + esc(t("A council with names gets one named invitation per row; a council with only a number of seats gets that many anonymous invitations. Existing councils are reused.")) + "</p></div>" +
        '<div class="card"><div class="field"><label>' + esc(t("File")) + '</label><input type="file" data-file accept=".xlsx,.xls,.csv,text/csv"></div>' +
        '<div class="field"><label>' + esc(t("Or paste rows (Council, Name, Seats, Votes each)")) + '</label><textarea data-text rows="6" placeholder="Addis Ababa, Abebe Kebede&#10;Oromia, , 3, 2"></textarea></div>' +
        '<button class="btn secondary block" data-preview>' + esc(t("Preview")) + "</button></div>" +
        '<div data-plan></div><div data-out></div>';
      var planBox = content.querySelector("[data-plan]");
      var out = content.querySelector("[data-out]");
      function showPlan() {
        if (!plan.length) { planBox.innerHTML = '<div class="card"><p class="empty">' + esc(t("Nothing to import yet.")) + "</p></div>"; return; }
        var total = plan.reduce(function (a, p) { return a + p.seats; }, 0);
        planBox.innerHTML = '<div class="section-title">' + esc(t("Preview")) + '</div><div class="list">' + plan.map(function (p) {
          return '<div class="row static"><div class="main"><div class="title">' + esc(p.name) + '</div><div class="meta">' + esc(t("{seats} invitations · {named} named", { seats: p.seats, named: p.names.length })) + (p.vote_weight > 1 ? " · " + esc(t("{n} votes each", { n: p.vote_weight })) : "") + "</div></div></div>";
        }).join("") + "</div>" +
          '<button class="btn block" data-run>' + esc(t("Create {councils} councils and {n} invitations", { councils: plan.length, n: total })) + "</button>";
        planBox.querySelector("[data-run]").onclick = runImport;
      }
      async function readFile(file) {
        if (/\.csv$/i.test(file.name) || /csv|text/.test(file.type)) return parseCsvText(await file.text());
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
        var wb = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
        var ws = wb.Sheets[wb.SheetNames[0]];
        return window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
      }
      content.querySelector("[data-file]").addEventListener("change", async function (ev) {
        var file = ev.target.files && ev.target.files[0];
        if (!file) return;
        try { plan = planFromRows(await readFile(file)); showPlan(); haptic("light"); } catch (err) { fail(err); }
      });
      content.querySelector("[data-preview]").onclick = function () {
        plan = planFromRows(parseCsvText(content.querySelector("[data-text]").value)); showPlan();
      };
      async function runImport() {
        if (!(await confirmDialog(t("Create the councils and issue all invitations now? One PDF per council will be sent to your chat.")))) return;
        planBox.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
        out.innerHTML = '<div class="card"><p class="hint" data-st>' + esc(t("Starting…")) + '</p><div class="progress"><span data-bar style="width:0%"></span></div><div data-log></div></div>';
        var st = out.querySelector("[data-st]"), bar = out.querySelector("[data-bar]"), log = out.querySelector("[data-log]");
        var done = 0, total = plan.reduce(function (a, p) { return a + p.seats; }, 0), allRows = [];
        try {
          for (var i = 0; i < plan.length; i++) {
            var p = plan[i];
            st.textContent = t("{name}: creating council…", { name: p.name });
            var r = await api("POST", "/councils", { name: p.name, seats: p.seats, vote_weight: p.vote_weight || 1, upsert: true });
            var names = p.names.length ? p.names : Array.apply(null, Array(p.seats)).map(function () { return ""; });
            var rows = await issueForCouncil(r.council.id, names, function (n) { st.textContent = t("{name}: {done} of {total} invitations…", { name: p.name, done: n, total: names.length }); bar.style.width = Math.round((done + n) / total * 100) + "%"; });
            done += rows.length;
            rows.forEach(function (x) { allRows.push({ token_id: x.token_id, password: x.password, full_name: x.full_name, region: p.name }); });
            st.textContent = t("{name}: sending PDF…", { name: p.name });
            await api("POST", "/councils/" + r.council.id + "/invitations-pdf", { rows: rows });
            log.insertAdjacentHTML("beforeend", '<p class="small">✅ ' + esc(p.name) + " — " + esc(t("{n} invitations, PDF sent", { n: rows.length })) + "</p>");
          }
          st.textContent = t("Sending the CSV with all codes…");
          await api("POST", "/members/credentials-file", { rows: allRows });
          haptic("success");
          st.textContent = t("Done: {n} invitations across {councils} councils. The PDFs and one CSV are in your chat.", { n: done, councils: plan.length });
          bar.style.width = "100%";
        } catch (err) {
          fail(err);
          st.textContent = t("Stopped after {n} invitations: {error}", { n: done, error: err.message });
          if (allRows.length) out.insertAdjacentHTML("beforeend", '<div class="card"><p class="danger-text">' + esc(t("Codes created before the error — copy them now:")) + "</p>" + credsTable(allRows.map(function (x) { return { token_id: x.token_id, password: x.password, full_name: x.full_name }; })) + "</div>");
        }
      }
      showPlan();
    },
  };

  // ---------------------------------------------------------------- ADMIN: broadcast
  views.broadcast = {
    title: function () { return t("Message all members"); },
    render: async function (content) {
      content.innerHTML = '<div class="card"><div class="field"><label>' + esc(t("Message (sent as a private message to every registered member)")) + "</label>" +
        '<textarea data-text rows="6" maxlength="3500" placeholder="' + esc(t("Voting on R1 (JOTA-JOTI host city) is now open — tap Vote in the app.")) + '"></textarea></div></div>' +
        '<button class="btn block" data-send>📣 ' + esc(t("Send")) + "</button>";
      content.querySelector("[data-send]").onclick = async function () {
        var text = content.querySelector("[data-text]").value.trim();
        if (!text) return toast(t("Write a message first"), "err");
        if (!(await confirmDialog(t("Send this message to all registered members?")))) return;
        var out = await runBatches(t("Broadcasting…"), function (offset) { return api("POST", "/broadcast", { text: text, offset: offset }); });
        if (out) { await alertDialog(t("Delivered to {sent} of {total} members.", { sent: out.sent, total: out.total }) + (out.failed ? " " + t("{n} could not be reached.", { n: out.failed }) : "")); back(); }
      };
    },
  };

  // ---------------------------------------------------------------- ADMIN: report
  views.report = {
    title: function () { return t("Assembly report"); },
    render: async function (content) {
      var emailOk = state.me.app.email_configured;
      content.innerHTML = '<div class="card"><p>' + t("Generates the full report — a <b>CSV</b> (one row per option) and a print-ready <b>HTML</b> document with results, turnout and an integrity statement — and sends both files to your private chat with the bot.") + "</p></div>" +
        '<div class="actions"><button class="btn block" data-r="0">📋 ' + esc(t("Send report to my chat")) + "</button>" +
        '<button class="btn secondary block" data-r="1"' + (emailOk ? "" : " disabled") + ">📧 " + esc(t("Send to my chat and email it")) + "</button></div>" +
        (emailOk ? "" : '<p class="hint">' + esc(t("Email is not configured (RESEND_API_KEY, REPORT_EMAIL_FROM, REPORT_EMAIL_TO).")) + "</p>");
      on(content, "[data-r]", "click", async function (e) {
        var btn = e.currentTarget; var email = btn.dataset.r === "1";
        content.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
        toast(t("Generating…"));
        try {
          var r = await api("POST", "/report", { email: email });
          haptic("success");
          await alertDialog(t("Report with {count} sent to your chat.", { count: plural(r.resolutions, "resolution") }) + (r.emailed_to ? " " + t("Emailed to {email}.", { email: r.emailed_to }) : r.email_error ? " " + r.email_error : ""));
        } catch (err) { fail(err); } finally { content.querySelectorAll("button").forEach(function (b) { b.disabled = false; }); }
      });
    },
  };

  // ---------------------------------------------------------------- ADMIN: setup
  views.setup = {
    title: function () { return t("Setup"); },
    action: function () { return { label: "↻", onClick: refresh }; },
    render: async function (content, params, alive) {
      var s = await api("GET", "/setup");
      state.linkedChatId = s.group ? s.group.chat_id : null;
      if (!alive()) return;
      function check(ok, title, detail, kind) {
        var icon = ok === true ? "✅" : ok === false ? (kind === "warn" ? "⚠️" : "❌") : "ℹ️";
        return '<div class="check"><div class="st">' + icon + '</div><div class="body"><b>' + title + "</b>" + (detail ? '<span class="hint">' + detail + "</span>" : "") + "</div></div>";
      }
      var wh = s.webhook;
      var html = '<div class="card"><h3>' + esc(t("Health")) + "</h3>" +
        check(s.db.ok, esc(t("Database")), s.db.ok ? esc(t("All tables present")) : esc(t("Missing tables: {tables}. Restart the app so the schema is applied, or run npm run db:migrate.", { tables: s.db.missing.join(", ") }))) +
        check(true, esc(t("Bot")), "@" + esc(s.bot.username) + " · " + esc(s.bot.name)) +
        (s.polling
          ? check(null, esc(t("Long-polling mode")), esc(t("No public URL — local development. The Mini App needs an HTTPS URL to be opened from Telegram.")))
          : check(wh ? wh.ok : false, esc(t("Webhook")), wh ? (wh.ok ? esc(t("Receiving updates at {url}", { url: wh.url })) : esc(t("Telegram points to “{url}”, expected {expected}", { url: wh.url || t("nothing"), expected: wh.expected }))) +
            (wh.last_error_message ? " · " + esc(t("Last error: {msg}", { msg: wh.last_error_message })) : "") + (wh.pending_update_count ? " · " + esc(t("{n} pending", { n: wh.pending_update_count })) : "") : esc(s.webhook_error || t("unknown")))) +
        check(s.last_update ? true : null, esc(t("Last update from Telegram")), s.last_update ? esc(fmtDate(s.last_update.at) + " · " + s.last_update.kind + (s.last_update.chat_title ? " · " + s.last_update.chat_title : s.last_update.chat_id ? " · " + s.last_update.chat_id : "") + (s.last_update.thread_id ? " · " + t("topic #{id}", { id: s.last_update.thread_id }) : "")) : esc(t("None since this server started. Post a message in the group and tap ↻ — if this line does not change, Telegram is not delivering updates here."))) +
        check(s.telegram_api_ms == null ? null : s.telegram_api_ms < 3000, esc(t("Telegram API round trip")), s.telegram_api_ms == null ? esc(t("unknown")) : esc(t("{ms} ms from this server to Telegram", { ms: s.telegram_api_ms }) + (s.telegram_api_ms >= 3000 ? " — " + t("slow: group updates and bot replies arrive late") : "")), "warn") +
        check(s.webhook_secret_set, esc(t("Webhook secret")), esc(s.webhook_secret_set ? t("WEBHOOK_SECRET is set") : t("Set WEBHOOK_SECRET in the environment")), "warn") +
        (s.mode === "serverless"
          ? check(s.cron_secret_set, esc(t("Auto-close scheduler (serverless)")), esc(t("Deadlines are checked on every request. For minute-accurate closing, have an external cron call {url} every minute.", { url: s.public_url + s.tick_path })), "warn")
          : check(true, esc(t("Auto-close scheduler")), esc(t("Runs every 30 seconds in this server process")))) +
        check(s.email_configured, esc(t("Email reports")), esc(s.email_configured ? t("Resend is configured") : t("Optional: set RESEND_API_KEY, REPORT_EMAIL_FROM, REPORT_EMAIL_TO")), "warn") +
        check(true, esc(t("Time zone")), esc(s.tz.label) + " (UTC" + (s.tz.offset_minutes >= 0 ? "+" : "-") + Math.abs(s.tz.offset_minutes / 60) + ")") +
        "</div>" +
        '<div class="actions">' + (s.polling ? "" : '<button class="btn block" data-act="webhook">🔗 ' + esc(t("Register webhook, commands and menu button")) + "</button>") +
        '<button class="btn secondary block" data-act="menu">📱 ' + esc(t("Refresh bot menu button")) + "</button></div>";

      // Group & topics
      html += '<div class="card"><h3>' + esc(t("Assembly group & topics")) + "</h3>" +
        (s.group ? "<p>" + esc(t("Linked group:")) + " <b>" + esc(s.group.title || s.group.chat_id) + '</b> <span class="hint">(' + s.group.chat_id + ")</span></p>" +
          (s.group_rights ? '<p class="hint">' + esc(t("Bot in the group:")) + " " + esc(s.group_rights.is_admin ? t("administrator") : t("not an administrator")) + " · " + esc(t("Manage topics")) + " " +
            (s.group_rights.can_manage_topics ? "✅" : "❌ — " + esc(t("without this right, renaming a topic here does not rename it in the group"))) +
            " · " + esc(t("Ban users")) + " " + (s.group_rights.can_restrict_members ? "✅" : "❌ — " + esc(t("without this right the bot cannot lock member permissions"))) + "</p>" : "") +
          (s.group_lock ? '<p class="hint">' + esc(t("Member permissions:")) + " " + (s.group_lock.locked ? "✅ " + esc(t("locked — only admins can add members, change the group, pin messages, create topics or post polls")) :
            "⚠️ " + esc(t("members can still: {list}", { list: s.group_lock.open.map(permLabel).join(", ") }))) + "</p>" : "") :
          '<p class="hint">' + esc(t("No group linked yet. Add the bot to the assembly supergroup as an administrator (it will link automatically), or post any message in the group.")) + "</p>") +
        '<p class="hint">' + esc(t("Topics appear here once the bot sees a message in them. Post a short message in each topic, then tap ↻. Names are learned when a topic is created or edited; you can rename them here.")) + "</p>";
      if (s.topics.length) {
        groupTopics(s.topics).forEach(function (g) {
          html += '<div class="section-title">' + esc(g.title) + '</div><div class="list">' + g.topics.map(function (tp) {
            return '<button class="row" data-topic="' + tp.chat_id + ":" + tp.thread_id + '"><div class="main"><div class="title">' + esc(topicName(tp)) +
              '</div><div class="meta">' + esc(tp.thread_id === 0 ? t("General") : t("ID {id}", { id: tp.thread_id })) + '</div></div><span class="chev">›</span></button>';
          }).join("") + "</div>";
        });
      }
      html += '<button class="btn secondary sm" data-act="addtopic">＋ ' + esc(t("Add topic by ID")) + "</button>" +
        (s.group ? ' <button class="btn secondary sm" data-act="signin">📝 ' + esc(t("Post sign-in topic")) + "</button>" : "") +
        (s.group ? ' <button class="btn secondary sm" data-act="lockgroup">🔒 ' + esc(t("Lock group for members")) + "</button>" : "") +
        (s.group ? ' <button class="btn secondary sm" data-act="unlinkgroup">' + esc(t("Unlink group")) + "</button>" : "") + "</div>";

      // People in the group (who is inside without being registered)
      if (s.group && s.people) {
        var pp = s.people;
        html += '<div class="card"><h3>' + esc(t("People in the group")) + "</h3>" +
          '<p class="hint">' + esc(t("Seen by the bot: {seen} · registered: {reg} · not registered: {unreg}", { seen: pp.seen, reg: pp.registered, unreg: pp.unregistered.length })) + "</p>" +
          '<p class="hint">' + esc(t("Telegram does not let bots list a group's members. People appear here when they join, are added, send a join request or post. Only registered members and admins belong in the assembly group.")) + "</p>" +
          '<label class="switch"><span class="lbl"><span>' + esc(t("Remove unregistered people automatically")) + '</span><span class="hint">' + esc(t("Off: the bot only tells the admins. On: anyone who joins without being registered is removed at once and told to register first.")) + '</span></span><input type="checkbox" data-gate' + (pp.gate_mode === "remove" ? " checked" : "") + "></label>";
        if (pp.unregistered.length) {
          html += '<div class="list">' + pp.unregistered.map(function (p) {
            return '<button class="row" data-person="' + p.user_id + '"><div class="main"><div class="title">' + esc(p.name) + (p.username ? ' <span class="hint">@' + esc(p.username) + "</span>" : "") + '</div><div class="meta">' + esc(p.status === "pending" ? t("wants to join") : t("in the group")) + " · " + esc(t("ID {id}", { id: p.user_id })) + '</div></div><span class="chev">›</span></button>';
          }).join("") + "</div>";
        } else {
          html += '<p class="hint">' + esc(t("Everyone the bot has seen is registered.")) + "</p>";
        }
        html += "</div>";
      }

      // Admins
      html += '<div class="card"><h3>' + esc(t("Admins")) + '</h3><div class="list">' +
        s.admins.env.map(function (id) { return '<div class="row static"><div class="main"><div class="title">' + id + '</div><div class="meta">' + esc(t("from ADMIN_TELEGRAM_IDS")) + "</div></div></div>"; }).join("") +
        s.admins.db.map(function (a) { return '<button class="row" data-admin="' + a.telegram_user_id + '"><div class="main"><div class="title">' + esc(a.name || a.telegram_user_id) + '</div><div class="meta">' + a.telegram_user_id + " · " + esc(t("added in app")) + '</div></div><span class="chev">›</span></button>'; }).join("") +
        '</div><p class="hint">' + esc(t("Admins can do everything in this panel. A person finds their Telegram ID by sending /whoami to the bot.")) + "</p>" +
        '<button class="btn secondary sm" data-act="addadmin">＋ ' + esc(t("Add admin")) + "</button></div>";

      html += '<div class="actions"><button class="btn secondary block" data-act="audit">🧾 ' + esc(t("Audit log")) + "</button>" +
        '<button class="btn secondary block" data-act="help">❔ ' + esc(t("Help and guides")) + "</button></div>" +
        '<p class="hint small">' + esc(t("Mode: {mode}", { mode: s.mode })) + (s.public_url ? " · " + esc(s.public_url) : "") + " · " + esc(t("Language: {lang}", { lang: I18N.label() })) + "</p>";
      content.innerHTML = html;

      on(content, "[data-act]", "click", async function (e) {
        var act = e.currentTarget.dataset.act;
        try {
          if (act === "webhook") { var w = await api("POST", "/setup/webhook"); haptic("success"); toast(w.ok ? t("Webhook registered") : t("Registered; Telegram reports {url}", { url: w.url }), w.ok ? "ok" : "err"); return refresh(); }
          if (act === "menu") { await api("POST", "/setup/menu"); haptic("success"); toast(t("Menu button updated"), "ok"); return; }
          if (act === "audit") return go("audit");
          if (act === "help") return go("help");
          if (act === "addadmin") {
            var v = await openSheet("<h2>" + esc(t("Add admin")) + '</h2><div class="field"><label>' + esc(t("Telegram user ID")) + '</label><input type="number" inputmode="numeric" data-id placeholder="' + esc(t("e.g. 123456789")) + '"></div>' +
              '<div class="field"><label>' + esc(t("Name (optional)")) + '</label><input type="text" data-name maxlength="120"></div><button class="btn block" data-ok>' + esc(t("Add")) + "</button>",
              function (sheet, close) { sheet.querySelector("[data-ok]").onclick = function () { close({ telegram_user_id: Number(sheet.querySelector("[data-id]").value), name: sheet.querySelector("[data-name]").value.trim() || null }); }; });
            if (!v) return;
            if (!v.telegram_user_id) return toast(t("Enter a Telegram ID"), "err");
            await api("POST", "/setup/admins", v); haptic("success"); toast(t("Admin added"), "ok"); return refresh();
          }
          if (act === "signin") {
            if (!(await confirmDialog(t("Post the sign-in card in the group? The bot creates a “Register / Sign in” topic if there is none yet and pins the card there.")))) return;
            var si = await api("POST", "/setup/group/signin");
            if (si.note) toast(si.note, "warn"); else { haptic("success"); toast(t("Sign-in card posted"), "ok"); }
            return refresh();
          }
          if (act === "lockgroup") {
            if (!(await confirmDialog(t("Take these away from ordinary members of the group: adding members, changing the group info, pinning messages, creating topics and posting polls? Admins keep them.")))) return;
            var lk = await api("POST", "/setup/group/lock");
            if (lk.ok) { haptic("success"); toast(t("Member permissions locked"), "ok"); }
            else if (lk.code === "no_rights") toast(t("The bot needs the “Ban users” administrator right to change member permissions."), "warn");
            else toast(lk.reason || t("Something went wrong"), "err");
            return refresh();
          }
          if (act === "unlinkgroup") {
            if (!(await confirmDialog(t("Unlink this group? Its topics are removed from the list. The bot links a group again as soon as it sees a message there.")))) return;
            await api("DELETE", "/setup/group"); haptic("success"); toast(t("Group unlinked"), "ok"); return refresh();
          }
          if (act === "addtopic") {
            var tv = await openSheet("<h2>" + esc(t("Add topic by ID")) + '</h2><p class="hint">' + esc(t("Open the topic in Telegram Desktop/Web: the URL ends in /<topic id>. The group chat ID is shown above once linked.")) + "</p>" +
              '<div class="field"><label>' + esc(t("Group chat ID")) + '</label><input type="number" data-chat value="' + (s.group ? s.group.chat_id : "") + '"' + (s.group ? " readonly" : "") + "></div>" +
              '<div class="field"><label>' + esc(t("Topic ID (0 = General)")) + '</label><input type="number" inputmode="numeric" data-thread></div>' +
              '<div class="field"><label>' + esc(t("Name")) + '</label><input type="text" data-name maxlength="128" placeholder="' + esc(t("e.g. Day 1 — Resolutions")) + '"></div><button class="btn block" data-ok>' + esc(t("Add")) + "</button>",
              function (sheet, close) { sheet.querySelector("[data-ok]").onclick = function () { close({ chat_id: Number(sheet.querySelector("[data-chat]").value), thread_id: Number(sheet.querySelector("[data-thread]").value || 0), name: sheet.querySelector("[data-name]").value.trim() }); }; });
            if (!tv) return;
            if (!tv.chat_id || !tv.name) return toast(t("Chat ID and name are required"), "err");
            await api("POST", "/setup/topics", tv); haptic("success"); toast(t("Topic added"), "ok"); return refresh();
          }
        } catch (err) { fail(err); }
      });
      on(content, "[data-topic]", "click", async function (e) {
        var parts = e.currentTarget.dataset.topic.split(":");
        var chat = Number(parts[0]), thread = Number(parts[1]);
        var tp = s.topics.filter(function (x) { return x.chat_id === chat && x.thread_id === thread; })[0];
        var a = await openSheet("<h2>" + esc(topicName(tp)) + '</h2><p class="hint">' + esc(t("Chat {chat} · topic {thread}", { chat: chat, thread: thread })) + "</p>" +
          '<div class="field"><label>' + esc(t("Name")) + '</label><input type="text" data-name maxlength="128" value="' + esc(tp.name || "") + '"></div>' +
          '<div class="actions"><button class="btn block" data-a="rename">' + esc(t("Save name")) + '</button><button class="btn secondary block" data-a="test">✉️ ' + esc(t("Send a test message here")) + "</button>" +
          (thread !== 0 ? '<button class="btn danger block" data-a="delete">' + esc(t("Remove from list")) + "</button>" : "") + "</div>",
          function (sheet, close) { on(sheet, "[data-a]", "click", function (e2) { close({ a: e2.currentTarget.dataset.a, name: sheet.querySelector("[data-name]").value.trim() }); }); });
        if (!a) return;
        try {
          if (a.a === "rename") {
            if (!a.name) return toast(t("Enter a name"), "err");
            var rr = await api("PATCH", "/setup/topics/" + chat + "/" + thread, { name: a.name });
            haptic("success");
            if (rr && rr.telegram) toast(t("Topic renamed in the group"), "ok");
            else if (rr && rr.code === "error" && rr.reason) toast(t("Name saved in the app only. Telegram refused the rename: {reason}", { reason: rr.reason }), "warn");
            else toast(t("Name saved in the app only. Give the bot the “Manage topics” admin right to rename it in the group."), "warn");
            return refresh();
          }
          else if (a.a === "test") { await api("POST", "/setup/test-message", { chat_id: chat, thread_id: thread }); }
          else if (a.a === "delete") { await api("DELETE", "/setup/topics/" + chat + "/" + thread); }
          haptic("success"); toast(t("Done"), "ok"); refresh();
        } catch (err) { fail(err); }
      });
      on(content, "[data-gate]", "change", async function (ev) {
        try {
          await api("POST", "/setup/group/gate", { mode: ev.target.checked ? "remove" : "flag" });
          haptic("success");
          toast(ev.target.checked ? t("Unregistered people are now removed automatically") : t("Unregistered people are now only reported to admins"), "ok");
        } catch (err) { fail(err); }
      });
      on(content, "[data-person]", "click", async function (ev) {
        var uid = Number(ev.currentTarget.dataset.person);
        var p = s.people.unregistered.filter(function (x) { return x.user_id === uid; })[0];
        if (!p) return;
        var councils = [];
        try { councils = (await api("GET", "/councils")).items || []; } catch (_) { /* no councils yet */ }
        var v = await openSheet("<h2>" + esc(p.name) + '</h2><p class="hint">' + esc(t("ID {id}", { id: p.user_id })) + (p.username ? " · @" + esc(p.username) : "") + " · " + esc(p.status === "pending" ? t("wants to join") : t("in the group")) + "</p>" +
          '<div class="field"><label>' + esc(t("Name")) + '</label><input type="text" data-name maxlength="120" value="' + esc(p.name) + '"></div>' +
          '<div class="field"><label>' + esc(t("Role")) + '</label><select data-role><option value="delegate">' + esc(t("Delegate (votes)")) + '</option><option value="admin">' + esc(t("Admin (runs the assembly, also votes)")) + "</option></select></div>" +
          (councils.length ? '<div class="field"><label>' + esc(t("Council")) + '</label><select data-council><option value="">' + esc(t("none")) + "</option>" + councils.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + (c.vote_weight > 1 ? " · ×" + c.vote_weight : "") + "</option>"; }).join("") + "</select></div>" : "") +
          '<button class="btn block" data-reg>✅ ' + esc(t("Register and link this Telegram account")) + "</button>" +
          (p.status === "pending" ? '<div class="actions inline"><button class="btn secondary sm" data-approve>' + esc(t("Approve join request")) + '</button><button class="btn secondary sm" data-decline>' + esc(t("Decline")) + "</button></div>" : "") +
          '<button class="btn danger block" data-remove>🚫 ' + esc(t("Remove from group")) + "</button>",
          function (sheet, close) {
            sheet.querySelector("[data-reg]").onclick = function () { close({ act: "register", name: sheet.querySelector("[data-name]").value.trim(), role: sheet.querySelector("[data-role]").value, council_id: sheet.querySelector("[data-council]") ? (sheet.querySelector("[data-council]").value || null) : null }); };
            if (sheet.querySelector("[data-approve]")) sheet.querySelector("[data-approve]").onclick = function () { close({ act: "approve" }); };
            if (sheet.querySelector("[data-decline]")) sheet.querySelector("[data-decline]").onclick = function () { close({ act: "decline" }); };
            sheet.querySelector("[data-remove]").onclick = function () { close({ act: "remove" }); };
          });
        if (!v) return;
        try {
          if (v.act === "register") { await api("POST", "/setup/group/people/" + uid + "/register", { name: v.name, role: v.role, council_id: v.council_id }); haptic("success"); toast(t("{name} registered and linked", { name: v.name || p.name }), "ok"); }
          else if (v.act === "remove") { if (!(await confirmDialog(t("Remove {name} from the group?", { name: p.name })))) return; await api("POST", "/setup/group/people/" + uid + "/remove"); toast(t("Removed from the group"), "ok"); }
          else if (v.act === "approve") { await api("POST", "/setup/group/people/" + uid + "/approve"); toast(t("Join request approved"), "ok"); }
          else { await api("POST", "/setup/group/people/" + uid + "/decline"); toast(t("Join request declined"), "ok"); }
          return refresh();
        } catch (err) { fail(err); }
      });
      on(content, "[data-admin]", "click", async function (e) {
        var id = Number(e.currentTarget.dataset.admin);
        if (!(await confirmDialog(t("Remove admin {id}?", { id: id })))) return;
        try { await api("DELETE", "/setup/admins/" + id); toast(t("Removed"), "ok"); refresh(); } catch (err) { fail(err); }
      });
    },
  };

  views.audit = {
    title: function () { return t("Audit log"); },
    action: function () { return { label: "↻", onClick: refresh }; },
    render: async function (content, params, alive) {
      var d = await api("GET", "/audit?limit=100");
      if (!alive()) return;
      content.innerHTML = d.items.length ? '<div class="list">' + d.items.map(function (r) {
        var det = r.details ? Object.keys(r.details).filter(function (k) { return k !== "via"; }).map(function (k) { return k + "=" + (typeof r.details[k] === "object" ? JSON.stringify(r.details[k]) : r.details[k]); }).join(", ") : "";
        return '<div class="row static"><div class="main"><div class="title">' + esc(r.action.replace(/_/g, " ")) + '</div><div class="meta">' + esc(r.created_at_local) + " · " + esc(t("by {actor}", { actor: r.actor })) + (r.details && r.details.via ? " " + esc(t("via {channel}", { channel: r.details.via })) : "") + "</div>" +
          (det ? '<div class="meta">' + esc(det) + "</div>" : "") + "</div></div>";
      }).join("") + "</div>" : '<div class="card"><p class="empty">' + esc(t("No entries yet.")) + "</p></div>";
    },
  };

  // ---------------------------------------------------------------- HELP (all roles)
  views.help = {
    title: function () { return t("Help"); },
    render: async function (content) {
      var role = state.me ? state.me.role : "guest";
      var sections = window.HELP.sections(role, I18N.lang());
      var html = '<div class="card"><p>' + esc(t("Step-by-step guides for everything you can do here. Tap a topic to expand it.")) + "</p>" +
        '<p class="hint">' + esc(t("Language: {lang}", { lang: I18N.label() })) + ' · <button class="btn ghost sm" data-lang>' + esc(t("Switch to {lang}", { lang: I18N.label(I18N.nextLang()) })) + "</button></p></div>";
      sections.forEach(function (sec, i) {
        html += '<details class="help"' + (sections.length === 1 || i === 0 && role === "guest" ? " open" : "") + "><summary>" + esc(sec.icon ? sec.icon + " " : "") + esc(sec.title) + "</summary><div class=\"help-body\">";
        sec.body.forEach(function (block) {
          if (typeof block === "string") html += "<p>" + esc(block) + "</p>";
          else if (block.steps) html += "<ol>" + block.steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>";
          else if (block.bullets) html += "<ul>" + block.bullets.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ul>";
          else if (block.tip) html += '<p class="help-tip">💡 ' + esc(block.tip) + "</p>";
          else if (block.warn) html += '<p class="help-warn">⚠️ ' + esc(block.warn) + "</p>";
        });
        html += "</div></details>";
      });
      html += '<p class="hint small">' + esc(t("Need more help? Contact the ESA National Office.")) + "</p>";
      content.innerHTML = html;
      content.querySelector("[data-lang]").onclick = switchLanguage;
    },
  };

  // ---------------------------------------------------------------- MEMBER: register
  views.register = {
    title: function () { return t("ESA Voting System"); },
    render: async function (content, params, alive) {
      // Code from the link, or the invitation the bot recognised when the member scanned their QR code.
      var inv = params.inv || null;
      if (!inv) {
        try { var pend = await api("GET", "/register/pending"); if (pend && pend.token_id) inv = pend.token_id; } catch (_) { /* fall back to typing the code */ }
        if (alive && !alive()) return;
      }
      content.innerHTML = '<div class="card"><h2>👋 ' + esc(t("Welcome")) + "</h2><p>" + esc(t("Register once with the credentials issued to you by the National Office. Your Telegram account is then linked to your voting token.")) + "</p></div>" +
        (inv ? '<div class="card"><p>🎫 ' + esc(t("Your invitation code was read from the link. Enter the password printed on your invitation.")) + "</p></div>" : "") +
        '<div class="card"><div class="field"><label>' + esc(t("Voting Token ID")) + '</label><input type="text" data-token autocapitalize="characters" autocomplete="off" placeholder="ESA-2026-K7M2P" value="' + esc(inv || "") + '"' + (inv ? " readonly" : "") + "></div>" +
        (inv ? '<p class="hint small"><a href="#" data-other>' + esc(t("Use a different code")) + "</a></p>" : "") +
        '<div class="field"><label>' + esc(t("Password")) + '</label><input type="password" data-pass autocomplete="off" placeholder="' + esc(t("from your credential slip")) + '"></div>' +
        '<p class="err hint" data-err hidden></p></div>' +
        '<button class="btn block" data-go>' + esc(t("Register")) + "</button>" +
        '<p class="hint">' + esc(t("Five wrong passwords lock the token for a while. Problems? Contact the National Office.")) + "</p>" +
        '<button class="btn secondary block" data-help>❔ ' + esc(t("How do I register?")) + "</button>";
      var errEl = content.querySelector("[data-err]");
      var MSG = {
        unknown_token: t("That token was not recognized. Check for typos (letters O/0 and I/1 are never used)."),
        conflict: t("This token is already registered to another Telegram account. Contact the National Office if this is an error."),
        locked: t("This token is temporarily locked after too many failed attempts. Try again later."),
        wrong_password: t("Wrong password. Please check your credential slip and try again."),
        locked_now: t("Wrong password — the token is now locked for a while."),
      };
      content.querySelector("[data-help]").onclick = function () { go("help"); };
      if (content.querySelector("[data-other]")) content.querySelector("[data-other]").onclick = function (ev) { ev.preventDefault(); var tk = content.querySelector("[data-token]"); tk.readOnly = false; tk.value = ""; tk.focus(); ev.currentTarget.parentNode.remove(); };
      if (inv) setTimeout(function () { try { content.querySelector("[data-pass]").focus(); } catch (_) { /* ignore */ } }, 100);
      content.querySelector("[data-go]").onclick = async function () {
        var token = content.querySelector("[data-token]").value.trim().toUpperCase();
        var pass = content.querySelector("[data-pass]").value;
        errEl.hidden = true;
        if (!token || !pass) { errEl.textContent = t("Enter both your token and password."); errEl.hidden = false; return; }
        this.disabled = true;
        try {
          var r = await api("POST", "/register", { token: token, password: pass });
          if (r.status === "ok") {
            haptic("success");
            state.me = await api("GET", "/me");
            toast(t("Registered as {name}", { name: r.member.full_name || r.member.token_id }), "ok");
            go("ballots", { focus: params.focus }, { root: true });
            return;
          }
          haptic("error");
          errEl.textContent = (MSG[r.status] || t("Registration failed.")) + (r.status === "locked_now" || r.status === "locked" ? " (" + t("{n} minutes", { n: r.lock_minutes }) + ")" : "");
          errEl.hidden = false;
          content.querySelector("[data-pass]").value = "";
        } catch (err) { fail(err); } finally { this.disabled = false; }
      };
    },
  };

  // ---------------------------------------------------------------- MEMBER: open ballots
  function ballotCard(e) {
    var html = '<div class="card" id="res-' + e.id + '"><h2>' + esc(e.code) + " — " + esc(e.title) + "</h2>" +
      (e.description ? "<p>" + esc(e.description) + "</p>" : "") +
      '<p class="hint">' + esc(e.anonymous ? "🔒 " + t("Secret ballot — your choice is anonymous and final.") : "✏️ " + t("Open ballot — you may change your vote until voting closes.")) +
      (e.closes_at_local ? "<br>⏰ " + esc(t("Closes {time}", { time: e.closes_at_local })) : "") + "</p>";
    if (e.voted && e.anonymous) {
      html += '<div class="verdict">☑️ ' + esc(t("Your ballot has been recorded. Thank you!")) + "</div>";
    } else {
      if (e.voted) html += '<p class="small">' + esc(t("Your current vote:")) + " <b>" + esc(e.options[e.my_choice] || "—") + "</b></p>";
      html += '<div class="options">' + e.options.map(function (o, i) {
        return '<button class="opt' + (e.voted && e.my_choice === i ? " chosen" : "") + '" data-vote="' + e.id + ":" + i + '"><span>' + esc(o) + "</span>" + (e.voted && e.my_choice === i ? "<span>✓</span>" : "") + "</button>";
      }).join("") + "</div>";
    }
    return html + "</div>";
  }

  async function castVote(res, i) {
    var opt = res.options[i];
    var msg = t("Vote “{option}” on {code}?", { option: opt, code: res.code }) + (res.anonymous ? "\n\n" + t("This is a secret ballot: once confirmed, your vote is final.") : "");
    if (!(await confirmDialog(msg))) return;
    try {
      var r = await api("POST", "/vote", { resolution_id: res.id, choice_index: i });
      if (r.result === "ok") { haptic("success"); await alertDialog(res.anonymous ? "✅ " + t("Ballot recorded. Thank you!") : "✅ " + t("Your vote for “{option}” is recorded. You may change it until voting closes.", { option: r.option })); }
      else if (r.result === "changed") { haptic("success"); toast(t("Vote changed to {option}", { option: r.option }), "ok"); }
      else if (r.result === "already_voted") { haptic("warning"); await alertDialog(t("You have already voted on this secret ballot; votes cannot be changed.")); }
      else if (r.result === "not_open") { haptic("warning"); await alertDialog(t("Voting is not open for this resolution.")); }
      else { haptic("error"); toast(t("Could not record your vote. Please try again."), "err"); }
      refresh();
    } catch (err) { fail(err); }
  }

  function closedRow(e, withDate) {
    return '<button class="row" data-r="' + e.id + '"><div class="main"><div class="title">' + esc(e.code) + " — " + esc(e.title) + '</div><div class="meta">' +
      esc(outcomeLabel(e)) + " · " + esc(plural(e.ballots, "ballot")) + (withDate && e.closed_at_local ? " · " + esc(e.closed_at_local) : "") + '</div></div><span class="chev">›</span></button>';
  }

  views.ballots = {
    title: function () { return t("Vote"); },
    action: function () { return { label: "↻", onClick: refresh }; },
    render: async function (content, params, alive) {
      var d = await api("GET", "/ballots");
      if (!alive()) return;
      var html = "";
      if (d.member) html += '<p class="hint">' + esc(t("Registered as")) + " <b>" + esc(d.member.full_name || d.member.token_id) + "</b>" + (d.member.vote_weight > 1 ? " · " + esc(t("your vote counts as {n} votes", { n: d.member.vote_weight })) : "") + "</p>";
      if (!d.open.length) {
        html += '<div class="card"><p class="empty">' + esc(t("No resolutions are open for voting right now.")) + (d.drafts ? " " + esc(t("{count} being prepared.", { count: plural(d.drafts, "resolution") })) : "") + "</p></div>";
      } else {
        d.open.forEach(function (e) { html += ballotCard(e); });
      }
      if (d.closed.length) html += '<div class="section-title">' + esc(t("Recent results")) + '</div><div class="list">' + d.closed.slice(0, 3).map(function (e) { return closedRow(e, false); }).join("") + "</div>";
      content.innerHTML = html;
      on(content, "[data-vote]", "click", function (ev) {
        var p = ev.currentTarget.dataset.vote.split(":");
        var res = d.open.filter(function (x) { return x.id === p[0]; })[0];
        if (res) castVote(res, Number(p[1]));
      });
      on(content, "[data-r]", "click", function (ev) { go("results", { id: ev.currentTarget.dataset.r }); });
      if (params.focus) {
        var target = content.querySelector("#res-" + params.focus);
        if (target) setTimeout(function () { target.scrollIntoView({ behavior: "smooth", block: "start" }); }, 50);
        params.focus = null;
      }
    },
  };

  views.closed = {
    title: function () { return t("Results"); },
    action: function () { return { label: "↻", onClick: refresh }; },
    render: async function (content, params, alive) {
      var d = await api("GET", "/ballots");
      if (!alive()) return;
      content.innerHTML = d.closed.length ? '<div class="list">' + d.closed.map(function (e) { return closedRow(e, true); }).join("") + "</div>" :
        '<div class="card"><p class="empty">' + esc(t("No results published yet. Results appear here when voting on a resolution closes.")) + "</p></div>";
      on(content, "[data-r]", "click", function (ev) { go("results", { id: ev.currentTarget.dataset.r }); });
    },
  };

  views.results = {
    title: function () { return t("Results"); },
    render: async function (content, params, alive) {
      var e = await api("GET", "/results/" + params.id);
      if (!alive()) return;
      content.innerHTML = '<div class="card"><h2>' + esc(e.code) + " — " + esc(e.title) + "</h2><div>" + statusBadge(e.status) + "</div>" +
        (e.description ? "<p>" + esc(e.description) + "</p>" : "") + '<p class="hint">' + esc(resolutionMeta(e)) + (e.closed_at_local ? " · " + esc(t("closed {time}", { time: e.closed_at_local })) : "") + "</p></div>" +
        '<div class="card"><h3>' + esc(e.status === "closed" ? t("Final results") : t("Interim results")) + "</h3>" + resultsHtml(e) + "</div>";
    },
  };

  views.me = {
    title: function () { return t("My registration"); },
    render: async function (content) {
      var m = state.me.member;
      content.innerHTML = '<div class="card"><h2>' + esc(m.full_name || m.token_id) + '</h2><dl class="kv"><dt>' + esc(t("Token")) + "</dt><dd><code>" + esc(m.token_id) + "</code></dd>" +
        (m.region ? "<dt>" + esc(t("Region")) + "</dt><dd>" + esc(m.region) + "</dd>" : "") +
        "<dt>" + esc(t("Registered")) + "</dt><dd>" + (m.registered_at ? esc(fmtDate(m.registered_at)) : "—") + "</dd>" +
        "<dt>" + esc(t("Telegram")) + "</dt><dd>" + esc(state.me.user.first_name + (state.me.user.last_name ? " " + state.me.user.last_name : "")) + "</dd>" +
        (m.vote_weight > 1 ? "<dt>" + esc(t("Vote weight")) + "</dt><dd>" + esc(t("Your ballot counts as {n} votes.", { n: m.vote_weight })) + "</dd>" : "") + "</dl></div>" +
        '<div class="card"><h3>' + esc(t("How voting works")) + '</h3><p class="small">' + t("Open resolutions appear under <b>Vote</b>. Tap an option and confirm. On a <b>secret ballot</b> your choice is stored without your name and cannot be changed. On an <b>open ballot</b> you may change your vote until voting closes. Results are published when voting closes.") +
        '</p><p class="small">' + esc(t("Lost your phone or changed account? Ask the National Office to detach your token; you can then register again with the same credentials.")) + "</p></div>" +
        '<div class="actions"><button class="btn secondary block" data-help>❔ ' + esc(t("Help and guides")) + "</button>" +
        '<button class="btn secondary block" data-lang>🌐 ' + esc(t("Switch to {lang}", { lang: I18N.label(I18N.nextLang()) })) + "</button></div>";
      content.querySelector("[data-help]").onclick = function () { go("help"); };
      content.querySelector("[data-lang]").onclick = switchLanguage;
    },
  };

  // ---------------------------------------------------------------- boot
  /** Deep-link parameters: ?r=<resolution id> / start_param vote_<id> focus a ballot; ?inv=<code> / start_param inv_<code> pre-fill registration. */
  function parseStart() {
    var qs = new URLSearchParams(location.search);
    var q = qs.get("r");
    var inv = qs.get("inv");
    var sp = tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param;
    if (sp && /^inv_/.test(sp)) { try { inv = inv || decodeURIComponent(sp.slice(4)); } catch (_) { /* ignore */ } sp = null; }
    if (sp && /^(vote_|r_)/.test(sp)) sp = sp.replace(/^(vote_|r_)/, "");
    var id = q || sp || null;
    return {
      focus: id && /^[0-9a-f-]{36}$/.test(id) ? id : null,
      inv: inv ? String(inv).trim().toUpperCase().slice(0, 40) : null,
    };
  }

  async function boot() {
    // Language: saved choice, else the Telegram client's language, else English.
    I18N.init(tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.language_code);
    document.documentElement.lang = I18N.lang();

    if (!tg || !tg.initData) {
      app.innerHTML = '<div class="screen-center"><h2>' + esc(t("Open in Telegram")) + '</h2><p class="hint">' + esc(t("This page only works inside the Telegram app. Open the voting bot in Telegram and tap the menu button next to the message box.")) + "</p></div>";
      return;
    }
    try { tg.ready(); tg.expand(); } catch (_) { /* ignore */ }
    try { tg.setHeaderColor("secondary_bg_color"); tg.setBackgroundColor("secondary_bg_color"); } catch (_) { /* older clients */ }
    try { tg.BackButton.onClick(back); } catch (_) { /* ignore */ }
    try { tg.disableVerticalSwipes(); } catch (_) { /* ignore */ }

    try {
      state.me = await api("GET", "/me");
    } catch (err) {
      app.innerHTML = '<div class="screen-center"><h2>' + esc(t("Could not sign in")) + '</h2><p class="hint">' + esc(err.message) + '</p><button class="btn" data-retry>' + esc(t("Retry")) + "</button></div>";
      app.querySelector("[data-retry]").onclick = boot;
      return;
    }
    var start = parseStart();
    if (state.me.role === "admin") {
      if (start.focus && state.me.member) go("ballots", { focus: start.focus }, { root: true });
      else go("home", {}, { root: true });
    } else if (state.me.role === "member") {
      go("ballots", { focus: start.focus }, { root: true });
    } else {
      go("register", { focus: start.focus, inv: start.inv }, { root: true });
    }
  }

  boot();
})();
