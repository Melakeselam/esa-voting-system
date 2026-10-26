/* ESA General Assembly Voting — Telegram Mini App (admin panel + member voting).
   Plain JavaScript, no build step. Talks to /api/app/* with Telegram initData auth. */
(function () {
  "use strict";

  var tg = window.Telegram && window.Telegram.WebApp;
  var app = document.getElementById("app");
  var toastEl = document.getElementById("toast");

  // ---------------------------------------------------------------- helpers
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function h(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
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
    toast(err && err.message ? err.message : "Something went wrong", "err");
  }
  function thresholdLabel(t) { return t === "two_thirds" ? "2/3 majority" : "simple majority"; }
  function statusBadge(status) {
    var label = status === "open" ? "🟢 Open" : status === "closed" ? "🔴 Closed" : "⚪ Draft";
    return '<span class="badge ' + status + '">' + label + "</span>";
  }
  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

  async function api(method, path, body) {
    var res = await fetch("/api/app" + path, {
      method: method,
      headers: { "content-type": "application/json", authorization: "tma " + tg.initData },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    var data = null;
    try { data = await res.json(); } catch (_) { /* no body */ }
    if (!res.ok) {
      var err = new Error((data && data.error) || "Request failed (" + res.status + ")");
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
    tabs.forEach(function (t) {
      var b = h('<button class="tab' + (root === t.name ? " on" : "") + '"><span class="ico">' + t.ico + "</span>" + esc(t.label) + "</button>");
      b.onclick = function () { haptic("light"); go(t.name, {}, { root: true }); };
      bar.append(b);
    });
    return bar;
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
        '<div class="card"><h2>Could not load</h2><p class="hint">' + esc(err.message) + "</p></div>" +
        '<button class="btn secondary block" data-retry>Retry</button>';
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
    topics.forEach(function (t) {
      var key = String(t.chat_id);
      if (!groups[key]) groups[key] = { chat_id: t.chat_id, title: t.chat_title || ("Chat " + t.chat_id), topics: [] };
      groups[key].topics.push(t);
    });
    return Object.keys(groups).map(function (k) { return groups[k]; });
  }

  /** Let the admin choose a group topic. Resolves {chat_id, thread_id, name} or null. */
  function pickTopic(topics, title) {
    if (!topics || topics.length === 0) {
      return openSheet(
        "<h2>" + esc(title || "Choose a topic") + "</h2>" +
          '<p class="hint">The bot has not seen any group topics yet. Add the bot to the assembly supergroup as an admin, ' +
          'then post any message in each topic — it will appear here. You can also add a topic by ID in Setup.</p>' +
          '<button class="btn secondary block" data-setup>Go to Setup</button>',
        function (sheet, close) {
          sheet.querySelector("[data-setup]").onclick = function () { close(null); go("setup"); };
        }
      );
    }
    var html = "<h2>" + esc(title || "Choose a topic") + "</h2>";
    groupTopics(topics).forEach(function (g) {
      html += '<div class="section-title">' + esc(g.title) + '</div><div class="list">';
      g.topics.forEach(function (t) {
        html += '<button class="row" data-chat="' + t.chat_id + '" data-thread="' + t.thread_id + '"><div class="main"><div class="title">' +
          esc(t.name || (t.thread_id === 0 ? "General" : "Topic #" + t.thread_id)) + '</div><div class="meta">' +
          (t.thread_id === 0 ? "General topic" : "Topic ID " + t.thread_id) + '</div></div><span class="chev">›</span></button>';
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
      "<h2>Open voting on " + esc(code) + "</h2>" +
      '<p class="hint">Members can vote as soon as voting opens. Choose when it should close.</p>' +
      '<button class="btn block" data-none>Open without a deadline (close manually)</button>' +
      '<div class="section-title">Close automatically after</div>' +
      '<div class="chips">' + quick.map(function (m) { return '<button class="chip" data-min="' + m + '">' + (m >= 60 ? (m / 60) + " h" : m + " min") + "</button>"; }).join("") + "</div>" +
      '<div class="inline-fields"><div class="field"><label>Custom minutes</label><input type="number" min="1" inputmode="numeric" data-custom placeholder="e.g. 25"></div>' +
      '<div class="field"><label>&nbsp;</label><button class="btn secondary block" data-custom-go>Open</button></div></div>' +
      '<div class="section-title">Or close at a specific time</div>' +
      '<div class="field"><label>Date and time (your device time)</label><input type="datetime-local" data-at min="' + minLocal + '"></div>' +
      '<button class="btn secondary block" data-at-go>Open with this deadline</button>';
    return openSheet(html, function (sheet, close) {
      sheet.querySelector("[data-none]").onclick = function () { close({}); };
      on(sheet, "[data-min]", "click", function (e) { close({ minutes: Number(e.currentTarget.dataset.min) }); });
      sheet.querySelector("[data-custom-go]").onclick = function () {
        var m = Number(sheet.querySelector("[data-custom]").value);
        if (!m || m < 1) return toast("Enter the number of minutes", "err");
        close({ minutes: Math.round(m) });
      };
      sheet.querySelector("[data-at-go]").onclick = function () {
        var v = sheet.querySelector("[data-at]").value;
        if (!v) return toast("Pick a date and time", "err");
        var d = new Date(v);
        if (isNaN(d.getTime()) || d.getTime() < Date.now() + 60000) return toast("The deadline must be in the future", "err");
        close({ closes_at: d.toISOString() });
      };
    });
  }

  /** Run a batched server job (broadcast, notify) with a progress sheet. */
  function runBatches(title, step) {
    return openSheet(
      "<h2>" + esc(title) + '</h2><p class="hint" data-status>Starting…</p><div class="progress"><span data-bar style="width:0%"></span></div>',
      async function (sheet, close) {
        var offset = 0, sent = 0, failed = 0, total = 0;
        try {
          for (;;) {
            var r = await step(offset);
            sent += r.sent; failed += r.failed; total = r.total;
            var done = r.next_offset === null ? total : r.next_offset;
            sheet.querySelector("[data-status]").textContent = "Sent " + sent + " of " + total + (failed ? " (" + failed + " unreachable)" : "");
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
    var bits = [e.anonymous ? "🔒 Secret ballot" : "✏️ Open ballot", thresholdLabel(e.threshold)];
    if (e.quorum) bits.push("Quorum " + e.quorum);
    bits.push(plural(e.options.length, "option"));
    return bits.join(" · ");
  }

  function resultsHtml(e) {
    if (!e.counts) return "";
    var total = e.counts.reduce(function (a, b) { return a + b; }, 0);
    var max = Math.max.apply(null, e.counts.concat([1]));
    var o = e.outcome || {};
    var leaders = o.leaders || [];
    var html = '<p class="hint">Ballots cast: <b>' + e.ballots + "</b>" +
      (e.quorum ? " · Quorum " + e.quorum + ": " + (o.quorumMet ? "✅ met" : "❌ not met") : "") +
      " · To pass: " + thresholdLabel(e.threshold) + "</p>";
    e.options.forEach(function (opt, i) {
      var n = e.counts[i];
      var pct = total ? Math.round(n / total * 100) : 0;
      var lead = leaders.length === 1 && leaders[0] === opt && n > 0;
      html += '<div class="result' + (lead ? " lead" : "") + '"><div class="lbl"><span>' + esc(opt) + '</span><span class="n">' + n + " · " + pct + '%</span></div>' +
        '<div class="bar"><span style="width:' + Math.round(n / max * 100) + '%"></span></div></div>';
    });
    if (e.status === "closed") {
      if (total === 0) html += '<div class="verdict rejected">❌ No votes were cast.</div>';
      else if (!o.quorumMet) html += '<div class="verdict warn">⚠️ Quorum not reached — the vote is not valid.</div>';
      else if (o.adopted) html += '<div class="verdict adopted">✅ ADOPTED: ' + esc(o.winner) + "</div>";
      else if (o.winner) html += '<div class="verdict rejected">❌ Not adopted — “' + esc(o.winner) + "” leads but does not reach the required " + thresholdLabel(e.threshold) + ".</div>";
      else html += '<div class="verdict warn">⚖️ Tie between ' + leaders.map(esc).join(", ") + " — not adopted.</div>";
    } else if (leaders.length === 1) {
      html += '<p class="small">▶️ Leading: <b>' + esc(o.winner) + "</b> (interim)</p>";
    } else if (leaders.length > 1) {
      html += '<p class="small">⚖️ Tie between ' + leaders.map(esc).join(", ") + " (interim)</p>";
    }
    return html;
  }

  function resolutionRow(e) {
    var meta = statusBadge(e.status) + " " + (e.anonymous ? "secret" : "open ballot") + " · " + plural(e.options.length, "option") +
      (e.status !== "draft" ? " · " + plural(e.ballots, "ballot") : "");
    return '<button class="row" data-res="' + e.id + '"><div class="main"><div class="title">' + esc(e.code) + " — " + esc(e.title) +
      '</div><div class="meta">' + meta + '</div></div><span class="chev">›</span></button>';
  }

  // ===================================================================== VIEWS
  var views = {};

  // ---------------------------------------------------------------- ADMIN: home
  views.home = {
    title: function () { return "ESA Voting — Admin"; },
    action: function () { return { label: "↻", onClick: refresh }; },
    render: async function (content, params, alive) {
      var d = await api("GET", "/dashboard");
      if (!alive()) return;
      var open = d.resolutions.filter(function (r) { return r.status === "open"; });
      var html =
        '<div class="kpis">' +
        '<div class="kpi"><div class="n">' + d.members.registered + '</div><div class="l">registered of ' + d.members.total + "</div></div>" +
        '<div class="kpi"><div class="n">' + d.summary.open + '</div><div class="l">open</div></div>' +
        '<div class="kpi"><div class="n">' + d.summary.closed + '</div><div class="l">closed</div></div>' +
        "</div>";
      if (!d.group) {
        html += '<div class="card"><h3>⚠️ No assembly group linked</h3><p class="hint">Add the bot to the assembly supergroup as an administrator. ' +
          "Announcements need a topic to post into.</p><button class=\"btn secondary sm\" data-go=\"setup\">Open Setup</button></div>";
      }
      html += '<div class="section-title">Open for voting</div>';
      html += open.length ? '<div class="list">' + open.map(resolutionRow).join("") + "</div>" :
        '<div class="card"><p class="empty">Nothing is open right now.</p></div>';
      html += '<div class="section-title">Quick actions</div><div class="actions">' +
        '<button class="btn block" data-go="resform">＋ New resolution</button>' +
        '<button class="btn secondary block" data-go="broadcast">📣 Message all members</button>' +
        '<button class="btn secondary block" data-go="report">📋 Assembly report</button>' +
        (state.me.member ? '<button class="btn secondary block" data-go="ballots">🗳 My ballot</button>' : "") +
        "</div>";
      content.innerHTML = html;
      on(content, "[data-res]", "click", function (e) { go("resolution", { id: e.currentTarget.dataset.res }); });
      on(content, "[data-go]", "click", function (e) { go(e.currentTarget.dataset.go); });
    },
  };

  // ---------------------------------------------------------------- ADMIN: resolutions list
  var resFilter = "all";
  views.resolutions = {
    title: function () { return "Resolutions"; },
    action: function () { return { label: "＋ New", onClick: function () { go("resform"); } }; },
    render: async function (content, params, alive) {
      var d = await api("GET", "/resolutions");
      if (!alive()) return;
      var filters = ["all", "draft", "open", "closed"];
      var items = d.items.filter(function (r) { return resFilter === "all" || r.status === resFilter; });
      var html = '<div class="chips">' + filters.map(function (f) {
        var n = f === "all" ? d.items.length : d.items.filter(function (r) { return r.status === f; }).length;
        return '<button class="chip' + (resFilter === f ? " on" : "") + '" data-f="' + f + '">' + f[0].toUpperCase() + f.slice(1) + " · " + n + "</button>";
      }).join("") + "</div>";
      html += items.length ? '<div class="list">' + items.map(resolutionRow).join("") + "</div>" :
        '<div class="card"><p class="empty">' + (d.items.length ? "No resolutions in this state." : "No resolutions yet. Tap “＋ New” to create the first one.") + "</p></div>";
      content.innerHTML = html;
      on(content, "[data-f]", "click", function (e) { resFilter = e.currentTarget.dataset.f; refresh(); });
      on(content, "[data-res]", "click", function (e) { go("resolution", { id: e.currentTarget.dataset.res }); });
    },
  };

  // ---------------------------------------------------------------- ADMIN: resolution detail
  views.resolution = {
    title: function () { return "Resolution"; },
    action: function () { return { label: "↻", onClick: refresh }; },
    render: async function (content, params, alive) {
      var e = await api("GET", "/resolutions/" + params.id);
      if (!alive()) return;
      var html = '<div class="card"><h2>' + esc(e.code) + " — " + esc(e.title) + "</h2>" +
        "<div>" + statusBadge(e.status) + "</div>" +
        (e.description ? "<p>" + esc(e.description) + "</p>" : "") +
        '<p class="hint">' + resolutionMeta(e) + "</p>";
      var kv = [];
      if (e.opened_at_local) kv.push(["Opened", e.opened_at_local]);
      if (e.status === "open") kv.push(["Closes", e.closes_at_local || "manually (no deadline)"]);
      if (e.closed_at_local) kv.push(["Closed", e.closed_at_local]);
      if (e.announce_chat_id) {
        var t = e.topics.filter(function (x) { return x.chat_id === e.announce_chat_id && x.thread_id === (e.announce_thread_id || 0); })[0];
        kv.push(["Announced in", t ? (t.name || "Topic #" + t.thread_id) : "a group topic"]);
      }
      if (kv.length) html += '<dl class="kv">' + kv.map(function (p) { return "<dt>" + esc(p[0]) + "</dt><dd>" + esc(p[1]) + "</dd>"; }).join("") + "</dl>";
      html += "</div>";

      if (e.status === "draft") {
        html += '<div class="card"><h3>Options</h3><ol style="margin:0;padding-left:20px">' + e.options.map(function (o) { return "<li>" + esc(o) + "</li>"; }).join("") + "</ol></div>";
        html += '<div class="actions">' +
          '<button class="btn block" data-act="open">🟢 Open voting</button>' +
          '<button class="btn secondary block" data-act="edit">✏️ Edit</button>' +
          '<button class="btn danger block" data-act="delete">🗑 Delete draft</button></div>';
      } else {
        html += '<div class="card"><h3>' + (e.status === "closed" ? "Final results" : "Interim results") + "</h3>" + resultsHtml(e) + "</div>";
        if (e.status === "open") {
          html += '<div class="actions">' +
            '<button class="btn block" data-act="announce">📢 Announce in a topic</button>' +
            '<button class="btn secondary block" data-act="notify">📨 Send ballot to all members</button>' +
            '<button class="btn secondary block" data-act="publish">📊 Post interim results</button>' +
            '<button class="btn danger block" data-act="close">🔴 Close voting now</button></div>';
        } else {
          html += '<div class="actions"><button class="btn secondary block" data-act="publish">📊 Post final results to a topic</button></div>';
        }
      }
      content.innerHTML = html;

      on(content, "[data-act]", "click", async function (ev) {
        var act = ev.currentTarget.dataset.act;
        haptic("light");
        try {
          if (act === "edit") return go("resform", { id: e.id });
          if (act === "delete") {
            if (!(await confirmDialog("Delete draft " + e.code + "? This cannot be undone."))) return;
            await api("DELETE", "/resolutions/" + e.id);
            toast(e.code + " deleted", "ok");
            return back();
          }
          if (act === "open") {
            var dl = await pickDeadline(e.code);
            if (dl === null) return;
            var r = await api("POST", "/resolutions/" + e.id + "/open", dl);
            haptic("success");
            toast("Voting is open" + (r.closes_at_local ? " until " + r.closes_at_local : ""), "ok");
            if (await confirmDialog("Announce " + e.code + " in a group topic now?")) {
              var tp = await pickTopic(e.topics, "Announce " + e.code + " in…");
              if (tp) { var a = await api("POST", "/resolutions/" + e.id + "/announce", tp); toast("Posted to " + a.posted_to, "ok"); }
            }
            return refresh();
          }
          if (act === "announce" || act === "publish") {
            var topic = await pickTopic(e.topics, act === "announce" ? "Announce " + e.code + " in…" : "Post results to…");
            if (!topic) return;
            var res = await api("POST", "/resolutions/" + e.id + "/" + act, topic);
            haptic("success");
            toast("Posted to " + res.posted_to, "ok");
            return refresh();
          }
          if (act === "notify") {
            if (!(await confirmDialog("Send the " + e.code + " ballot as a private message to every registered member?"))) return;
            var out = await runBatches("Sending ballot…", function (offset) { return api("POST", "/resolutions/" + e.id + "/notify", { offset: offset }); });
            if (out) await alertDialog("Ballot delivered to " + out.sent + " of " + out.total + " members." + (out.failed ? " " + out.failed + " could not be reached (they must open the bot first)." : ""));
            return;
          }
          if (act === "close") {
            if (!(await confirmDialog("Close voting on " + e.code + " now? Final results will be published" + (e.announce_chat_id ? " to the announcement topic." : ".")))) return;
            await api("POST", "/resolutions/" + e.id + "/close");
            haptic("success");
            toast("Voting closed", "ok");
            return refresh();
          }
        } catch (err) { fail(err); }
      });
    },
  };

  // ---------------------------------------------------------------- ADMIN: new / edit resolution
  views.resform = {
    title: function (p) { return p.id ? "Edit resolution" : "New resolution"; },
    render: async function (content, params, alive) {
      var e = params.id ? await api("GET", "/resolutions/" + params.id) : null;
      if (!alive()) return;
      if (e && e.status !== "draft") { content.innerHTML = '<div class="card"><p>Only drafts can be edited.</p></div>'; return; }
      var options = e ? e.options.slice() : ["", ""];
      var html = '<div class="card">' +
        '<div class="field"><label>Title *</label><input type="text" data-f="title" maxlength="200" placeholder="e.g. Host city for JOTA-JOTI 2026" value="' + esc(e ? e.title : "") + '"></div>' +
        '<div class="field"><label>Description (optional)</label><textarea data-f="description" maxlength="2000" placeholder="Shown to members on the ballot">' + esc(e ? e.description || "" : "") + "</textarea></div>" +
        "</div>" +
        '<div class="card"><h3>Options *</h3><div data-options></div>' +
        '<div class="actions inline"><button class="btn secondary sm" data-add>＋ Add option</button><button class="btn secondary sm" data-abstain>＋ Abstain</button></div>' +
        '<p class="hint">2–12 options. An option named “Abstain” counts toward quorum but not toward the majority.</p></div>' +
        '<div class="card">' +
        '<label class="switch"><span class="lbl"><span>Secret ballot</span><span class="hint">Choices are stored anonymously and are final</span></span><input type="checkbox" data-f="anonymous"' + (!e || e.anonymous ? " checked" : "") + "></label>" +
        '<div class="inline-fields">' +
        '<div class="field"><label>Quorum (ballots)</label><input type="number" min="1" inputmode="numeric" data-f="quorum" placeholder="none" value="' + (e && e.quorum ? e.quorum : "") + '"></div>' +
        '<div class="field"><label>Majority to adopt</label><select data-f="threshold"><option value="simple"' + (!e || e.threshold === "simple" ? " selected" : "") + '>Simple majority</option><option value="two_thirds"' + (e && e.threshold === "two_thirds" ? " selected" : "") + ">2/3 majority</option></select></div>" +
        "</div></div>" +
        '<button class="btn block" data-save>' + (e ? "Save changes" : "Create draft") + "</button>";
      content.innerHTML = html;

      var optBox = content.querySelector("[data-options]");
      function drawOptions() {
        optBox.innerHTML = options.map(function (o, i) {
          return '<div class="option-row"><input type="text" maxlength="60" placeholder="Option ' + (i + 1) + '" data-opt="' + i + '" value="' + esc(o) + '">' +
            (options.length > 2 ? '<button class="x" data-rm="' + i + '" aria-label="Remove">×</button>' : "") + "</div>";
        }).join("");
        on(optBox, "[data-opt]", "input", function (ev) { options[Number(ev.target.dataset.opt)] = ev.target.value; });
        on(optBox, "[data-rm]", "click", function (ev) { options.splice(Number(ev.currentTarget.dataset.rm), 1); drawOptions(); });
      }
      drawOptions();
      content.querySelector("[data-add]").onclick = function () { if (options.length >= 12) return toast("At most 12 options", "err"); options.push(""); drawOptions(); optBox.querySelector("[data-opt='" + (options.length - 1) + "']").focus(); };
      content.querySelector("[data-abstain]").onclick = function () { if (options.some(function (o) { return /^abstain/i.test(o.trim()); })) return toast("Already has an Abstain option"); options.push("Abstain"); drawOptions(); };
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
        if (body.title.length < 3) return toast("Please enter a title", "err");
        if (body.options.length < 2) return toast("At least two options are required", "err");
        this.disabled = true;
        try {
          var r = e ? await api("PATCH", "/resolutions/" + e.id, body) : await api("POST", "/resolutions", body);
          haptic("success");
          toast(e ? "Saved" : r.code + " created as a draft", "ok");
          state.stack.pop();
          if (e) refresh(); else go("resolution", { id: r.id });
        } catch (err) { this.disabled = false; fail(err); }
      };
    },
  };

  // ---------------------------------------------------------------- ADMIN: members
  var memQ = "", memFilter = "all";
  views.members = {
    title: function () { return "Members"; },
    action: function () { return { label: "＋ Credentials", onClick: function () { go("generate"); } }; },
    render: async function (content, params, alive) {
      var page = 0;
      var d = await api("GET", "/members?q=" + encodeURIComponent(memQ) + "&filter=" + memFilter + "&page=0");
      if (!alive()) return;
      var filters = [["all", "All"], ["registered", "Registered"], ["unregistered", "Not registered"], ["locked", "Locked"], ["inactive", "Deactivated"]];
      content.innerHTML =
        '<div class="kpis"><div class="kpi"><div class="n">' + d.counts.total + '</div><div class="l">tokens issued</div></div>' +
        '<div class="kpi"><div class="n">' + d.counts.registered + '</div><div class="l">registered</div></div>' +
        '<div class="kpi"><div class="n">' + (d.counts.total - d.counts.active) + '</div><div class="l">deactivated</div></div></div>' +
        '<div class="field"><input type="text" data-q placeholder="Search token, name or region" value="' + esc(memQ) + '"></div>' +
        '<div class="chips">' + filters.map(function (f) { return '<button class="chip' + (memFilter === f[0] ? " on" : "") + '" data-f="' + f[0] + '">' + f[1] + "</button>"; }).join("") + "</div>" +
        '<p class="hint" data-total>' + plural(d.total, "member") + "</p>" +
        '<div class="list" data-list></div>' +
        '<button class="btn secondary block" data-more hidden>Load more</button>';
      var list = content.querySelector("[data-list]");
      var more = content.querySelector("[data-more]");

      function memberRow(m) {
        var badges = (m.telegram_user_id ? '<span class="badge ok">registered</span>' : '<span class="badge">not registered</span>') +
          (m.locked ? ' <span class="badge warn">locked</span>' : "") + (!m.is_active ? ' <span class="badge err">deactivated</span>' : "");
        return '<button class="row" data-m="' + m.id + '"><div class="main"><div class="title">' + esc(m.full_name || m.token_id) + '</div><div class="meta"><code>' + esc(m.token_id) + "</code>" +
          (m.region ? " · " + esc(m.region) : "") + "</div><div>" + badges + '</div></div><span class="chev">›</span></button>';
      }
      var shown = [];
      function append(items) {
        items.forEach(function (m) { shown.push(m); list.insertAdjacentHTML("beforeend", memberRow(m)); });
        more.hidden = shown.length >= d.total;
        if (!d.total) list.innerHTML = '<p class="empty">No members match.</p>';
      }
      append(d.items);
      list.addEventListener("click", async function (ev) {
        var row = ev.target.closest("[data-m]");
        if (!row) return;
        var m = shown.filter(function (x) { return x.id === row.dataset.m; })[0];
        if (!m) return;
        var html = "<h2>" + esc(m.full_name || m.token_id) + '</h2><dl class="kv"><dt>Token</dt><dd><code>' + esc(m.token_id) + "</code></dd>" +
          (m.region ? "<dt>Region</dt><dd>" + esc(m.region) + "</dd>" : "") +
          "<dt>Status</dt><dd>" + (m.telegram_user_id ? "Registered " + (m.registered_at ? new Date(m.registered_at).toLocaleString() : "") : "Not registered yet") + "</dd>" +
          (m.locked ? "<dt>Lock</dt><dd>Locked until " + new Date(m.locked_until).toLocaleTimeString() + "</dd>" : "") + "</dl>" +
          '<div class="actions">' +
          (m.telegram_user_id ? '<button class="btn secondary block" data-a="unbind">🔓 Detach Telegram account (lost phone)</button>' : "") +
          (m.locked ? '<button class="btn secondary block" data-a="unlock">🔑 Unlock now</button>' : "") +
          (m.is_active ? '<button class="btn danger block" data-a="deactivate">🚫 Deactivate token</button>' : '<button class="btn block" data-a="activate">✅ Reactivate token</button>') +
          "</div>";
        var a = await openSheet(html, function (sheet, close) { on(sheet, "[data-a]", "click", function (e2) { close(e2.currentTarget.dataset.a); }); });
        if (!a) return;
        try {
          if (a === "unbind") {
            if (!(await confirmDialog("Detach " + m.token_id + " from its Telegram account? The member can then register again with the same credentials."))) return;
            await api("POST", "/members/" + m.id + "/unbind");
          } else if (a === "unlock") {
            await api("POST", "/members/" + m.id + "/unlock");
          } else if (a === "deactivate") {
            if (!(await confirmDialog("Deactivate " + m.token_id + "? The member will not be able to register or vote until reactivated."))) return;
            await api("POST", "/members/" + m.id + "/active", { active: false });
          } else if (a === "activate") {
            await api("POST", "/members/" + m.id + "/active", { active: true });
          }
          haptic("success"); toast("Done", "ok"); refresh();
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
    title: function () { return "Generate credentials"; },
    render: async function (content) {
      content.innerHTML =
        '<div class="card"><p class="hint">Creates a Token ID + password for each member and stores only a hash. ' +
        "The plaintext list is sent to <b>your</b> Telegram chat as a CSV — the only copy. Distribute it securely, then delete the file.</p></div>" +
        '<div class="card"><div class="chips"><button class="chip on" data-mode="names">By names</button><button class="chip" data-mode="count">By count</button></div>' +
        '<div class="field" data-names-box><label>One member per line: Full Name, Region</label><textarea data-names rows="8" placeholder="Abebe Kebede, Addis Ababa&#10;Sara Tesfaye, Oromia"></textarea></div>' +
        '<div class="field" data-count-box hidden><label>Number of anonymous tokens</label><input type="number" min="1" max="2000" inputmode="numeric" data-count value="10"></div>' +
        '<div class="field"><label>Token prefix</label><input type="text" data-prefix value="ESA-2026" maxlength="20"></div></div>' +
        '<button class="btn block" data-gen>Generate</button>' +
        '<div data-out></div>';
      var mode = "names";
      on(content, "[data-mode]", "click", function (e) {
        mode = e.currentTarget.dataset.mode;
        content.querySelectorAll("[data-mode]").forEach(function (c) { c.classList.toggle("on", c.dataset.mode === mode); });
        content.querySelector("[data-names-box]").hidden = mode !== "names";
        content.querySelector("[data-count-box]").hidden = mode !== "count";
      });
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
          if (!n || n < 1 || n > 2000) return toast("Enter a count between 1 and 2000", "err");
          people = []; for (var i = 0; i < n; i++) people.push({ name: null, region: null });
        }
        if (!people.length) return toast("Add at least one member", "err");
        if (!(await confirmDialog("Generate " + plural(people.length, "credential") + " with prefix " + prefix + "?"))) return;
        var btn = this; btn.disabled = true;
        var out = content.querySelector("[data-out]");
        out.innerHTML = '<div class="card"><p class="hint" data-st>Generating…</p><div class="progress"><span data-bar style="width:0%"></span></div></div>';
        var rows = [];
        try {
          for (var off = 0; off < people.length; off += 40) {
            var r = await api("POST", "/members/generate", { people: people.slice(off, off + 40), prefix: prefix });
            rows = rows.concat(r.rows);
            out.querySelector("[data-st]").textContent = "Generated " + rows.length + " of " + people.length + "…";
            out.querySelector("[data-bar]").style.width = Math.round(rows.length / people.length * 100) + "%";
          }
          out.querySelector("[data-st]").textContent = "Sending the CSV to your chat…";
          await api("POST", "/members/credentials-file", { rows: rows });
          haptic("success");
          out.innerHTML = '<div class="card"><h3>✅ ' + plural(rows.length, "credential") + " created</h3>" +
            '<p class="hint">The CSV with the passwords was sent to your private chat with the bot. Delete it from the chat once distributed.</p>' +
            '<details><summary>Show credentials here</summary><table class="creds"><tr><th>Token</th><th>Password</th><th>Name</th></tr>' +
            rows.map(function (x) { return "<tr><td><code>" + esc(x.token_id) + "</code></td><td><code>" + esc(x.password) + "</code></td><td>" + esc(x.full_name || "") + "</td></tr>"; }).join("") +
            "</table></details></div>";
        } catch (err) {
          fail(err);
          if (rows.length) out.innerHTML += '<div class="card"><p class="danger-text">' + rows.length + " credentials were created before the error. Their passwords are shown below — copy them now.</p>" +
            '<table class="creds">' + rows.map(function (x) { return "<tr><td><code>" + esc(x.token_id) + "</code></td><td><code>" + esc(x.password) + "</code></td><td>" + esc(x.full_name || "") + "</td></tr>"; }).join("") + "</table></div>";
        } finally { btn.disabled = false; }
      };
    },
  };

  // ---------------------------------------------------------------- ADMIN: broadcast
  views.broadcast = {
    title: function () { return "Message all members"; },
    render: async function (content) {
      content.innerHTML = '<div class="card"><div class="field"><label>Message (sent as a private message to every registered member)</label>' +
        '<textarea data-text rows="6" maxlength="3500" placeholder="Voting on R1 (JOTA-JOTI host city) is now open — tap Vote in the app."></textarea></div></div>' +
        '<button class="btn block" data-send>📣 Send</button>';
      content.querySelector("[data-send]").onclick = async function () {
        var text = content.querySelector("[data-text]").value.trim();
        if (!text) return toast("Write a message first", "err");
        if (!(await confirmDialog("Send this message to all registered members?"))) return;
        var out = await runBatches("Broadcasting…", function (offset) { return api("POST", "/broadcast", { text: text, offset: offset }); });
        if (out) { await alertDialog("Delivered to " + out.sent + " of " + out.total + " members." + (out.failed ? " " + out.failed + " could not be reached." : "")); back(); }
      };
    },
  };

  // ---------------------------------------------------------------- ADMIN: report
  views.report = {
    title: function () { return "Assembly report"; },
    render: async function (content) {
      var emailOk = state.me.app.email_configured;
      content.innerHTML = '<div class="card"><p>Generates the full report — a <b>CSV</b> (one row per option) and a print-ready <b>HTML</b> document with results, turnout and an integrity statement — and sends both files to your private chat with the bot.</p></div>' +
        '<div class="actions"><button class="btn block" data-r="0">📋 Send report to my chat</button>' +
        '<button class="btn secondary block" data-r="1"' + (emailOk ? "" : " disabled") + ">📧 Send to my chat and email it</button></div>" +
        (emailOk ? "" : '<p class="hint">Email is not configured (RESEND_API_KEY, REPORT_EMAIL_FROM, REPORT_EMAIL_TO).</p>');
      on(content, "[data-r]", "click", async function (e) {
        var btn = e.currentTarget; var email = btn.dataset.r === "1";
        content.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
        toast("Generating…");
        try {
          var r = await api("POST", "/report", { email: email });
          haptic("success");
          await alertDialog("Report with " + plural(r.resolutions, "resolution") + " sent to your chat." + (r.emailed_to ? " Emailed to " + r.emailed_to + "." : r.email_error ? " " + r.email_error : ""));
        } catch (err) { fail(err); } finally { content.querySelectorAll("button").forEach(function (b) { b.disabled = false; }); }
      });
    },
  };

  // ---------------------------------------------------------------- ADMIN: setup
  views.setup = {
    title: function () { return "Setup"; },
    action: function () { return { label: "↻", onClick: refresh }; },
    render: async function (content, params, alive) {
      var s = await api("GET", "/setup");
      if (!alive()) return;
      function check(ok, title, detail, kind) {
        var icon = ok === true ? "✅" : ok === false ? (kind === "warn" ? "⚠️" : "❌") : "ℹ️";
        return '<div class="check"><div class="st">' + icon + '</div><div class="body"><b>' + title + "</b>" + (detail ? '<span class="hint">' + detail + "</span>" : "") + "</div></div>";
      }
      var wh = s.webhook;
      var html = '<div class="card"><h3>Health</h3>' +
        check(s.db.ok, "Database", s.db.ok ? "All tables present" : "Missing tables: " + esc(s.db.missing.join(", ")) + ". Run supabase/migrations/2026-10-26_miniapp.sql (or schema.sql) in the Supabase SQL editor.") +
        check(true, "Bot", "@" + esc(s.bot.username) + " · " + esc(s.bot.name)) +
        (s.polling
          ? check(null, "Long-polling mode", "No public URL — local development. The Mini App needs an HTTPS URL to be opened from Telegram.")
          : check(wh ? wh.ok : false, "Webhook", wh ? (wh.ok ? "Receiving updates at " + esc(wh.url) : "Telegram points to “" + esc(wh.url || "nothing") + "”, expected " + esc(wh.expected)) +
            (wh.last_error_message ? " · Last error: " + esc(wh.last_error_message) : "") + (wh.pending_update_count ? " · " + wh.pending_update_count + " pending" : "") : esc(s.webhook_error || "unknown"))) +
        check(s.webhook_secret_set, "Webhook secret", s.webhook_secret_set ? "WEBHOOK_SECRET is set" : "Set WEBHOOK_SECRET in the environment", "warn") +
        (s.mode === "serverless"
          ? check(s.cron_secret_set, "Auto-close scheduler (serverless)", "Deadlines are checked on every request and once a day by Vercel Cron. For minute-accurate closing, have a free external cron (e.g. cron-job.org) call <code>" + esc(s.public_url + s.tick_path) + "</code> every minute.", "warn")
          : check(true, "Auto-close scheduler", "Runs every 30 seconds in this server process")) +
        check(s.email_configured, "Email reports", s.email_configured ? "Resend is configured" : "Optional: set RESEND_API_KEY, REPORT_EMAIL_FROM, REPORT_EMAIL_TO", "warn") +
        check(true, "Time zone", esc(s.tz.label) + " (UTC" + (s.tz.offset_minutes >= 0 ? "+" : "-") + Math.abs(s.tz.offset_minutes / 60) + ")") +
        "</div>" +
        '<div class="actions">' + (s.polling ? "" : '<button class="btn block" data-act="webhook">🔗 Register webhook, commands and menu button</button>') +
        '<button class="btn secondary block" data-act="menu">📱 Refresh bot menu button</button></div>';

      // Group & topics
      html += '<div class="card"><h3>Assembly group & topics</h3>' +
        (s.group ? '<p>Linked group: <b>' + esc(s.group.title || s.group.chat_id) + '</b> <span class="hint">(' + s.group.chat_id + ")</span></p>" :
          '<p class="hint">No group linked yet. Add the bot to the assembly supergroup as an administrator (it will link automatically), or post any message in the group.</p>') +
        '<p class="hint">Topics appear here once the bot sees a message in them. Post a short message in each topic, then tap ↻. Names are learned when a topic is created or edited; you can rename them here.</p>';
      if (s.topics.length) {
        groupTopics(s.topics).forEach(function (g) {
          html += '<div class="section-title">' + esc(g.title) + '</div><div class="list">' + g.topics.map(function (t) {
            return '<button class="row" data-topic="' + t.chat_id + ":" + t.thread_id + '"><div class="main"><div class="title">' + esc(t.name || (t.thread_id === 0 ? "General" : "Topic #" + t.thread_id)) +
              '</div><div class="meta">' + (t.thread_id === 0 ? "General" : "ID " + t.thread_id) + '</div></div><span class="chev">›</span></button>';
          }).join("") + "</div>";
        });
      }
      html += '<button class="btn secondary sm" data-act="addtopic">＋ Add topic by ID</button></div>';

      // Admins
      html += '<div class="card"><h3>Admins</h3><div class="list">' +
        s.admins.env.map(function (id) { return '<div class="row static"><div class="main"><div class="title">' + id + '</div><div class="meta">from ADMIN_TELEGRAM_IDS</div></div></div>'; }).join("") +
        s.admins.db.map(function (a) { return '<button class="row" data-admin="' + a.telegram_user_id + '"><div class="main"><div class="title">' + esc(a.name || a.telegram_user_id) + '</div><div class="meta">' + a.telegram_user_id + " · added in app</div></div><span class=\"chev\">›</span></button>"; }).join("") +
        '</div><p class="hint">Admins can do everything in this panel. A person finds their Telegram ID by sending /whoami to the bot.</p>' +
        '<button class="btn secondary sm" data-act="addadmin">＋ Add admin</button></div>';

      html += '<div class="actions"><button class="btn secondary block" data-act="audit">🧾 Audit log</button></div>' +
        '<p class="hint small">Mode: ' + esc(s.mode) + (s.public_url ? " · " + esc(s.public_url) : "") + "</p>";
      content.innerHTML = html;

      on(content, "[data-act]", "click", async function (e) {
        var act = e.currentTarget.dataset.act;
        try {
          if (act === "webhook") { var w = await api("POST", "/setup/webhook"); haptic("success"); toast(w.ok ? "Webhook registered" : "Registered; Telegram reports " + w.url, w.ok ? "ok" : "err"); return refresh(); }
          if (act === "menu") { await api("POST", "/setup/menu"); haptic("success"); toast("Menu button updated", "ok"); return; }
          if (act === "audit") return go("audit");
          if (act === "addadmin") {
            var v = await openSheet("<h2>Add admin</h2><div class=\"field\"><label>Telegram user ID</label><input type=\"number\" inputmode=\"numeric\" data-id placeholder=\"e.g. 123456789\"></div>" +
              '<div class="field"><label>Name (optional)</label><input type="text" data-name maxlength="120"></div><button class="btn block" data-ok>Add</button>',
              function (sheet, close) { sheet.querySelector("[data-ok]").onclick = function () { close({ telegram_user_id: Number(sheet.querySelector("[data-id]").value), name: sheet.querySelector("[data-name]").value.trim() || null }); }; });
            if (!v) return;
            if (!v.telegram_user_id) return toast("Enter a Telegram ID", "err");
            await api("POST", "/setup/admins", v); haptic("success"); toast("Admin added", "ok"); return refresh();
          }
          if (act === "addtopic") {
            var t = await openSheet("<h2>Add topic by ID</h2><p class=\"hint\">Open the topic in Telegram Desktop/Web: the URL ends in /&lt;topic id&gt;. The group chat ID is shown above once linked.</p>" +
              '<div class="field"><label>Group chat ID</label><input type="number" data-chat value="' + (s.group ? s.group.chat_id : "") + '"></div>' +
              '<div class="field"><label>Topic ID (0 = General)</label><input type="number" inputmode="numeric" data-thread></div>' +
              '<div class="field"><label>Name</label><input type="text" data-name maxlength="128" placeholder="e.g. Day 1 — Resolutions"></div><button class="btn block" data-ok>Add</button>',
              function (sheet, close) { sheet.querySelector("[data-ok]").onclick = function () { close({ chat_id: Number(sheet.querySelector("[data-chat]").value), thread_id: Number(sheet.querySelector("[data-thread]").value || 0), name: sheet.querySelector("[data-name]").value.trim() }); }; });
            if (!t) return;
            if (!t.chat_id || !t.name) return toast("Chat ID and name are required", "err");
            await api("POST", "/setup/topics", t); haptic("success"); toast("Topic added", "ok"); return refresh();
          }
        } catch (err) { fail(err); }
      });
      on(content, "[data-topic]", "click", async function (e) {
        var parts = e.currentTarget.dataset.topic.split(":");
        var chat = Number(parts[0]), thread = Number(parts[1]);
        var t = s.topics.filter(function (x) { return x.chat_id === chat && x.thread_id === thread; })[0];
        var a = await openSheet("<h2>" + esc(t.name || "Topic #" + thread) + '</h2><p class="hint">Chat ' + chat + " · topic " + thread + "</p>" +
          '<div class="field"><label>Name</label><input type="text" data-name maxlength="128" value="' + esc(t.name || "") + '"></div>' +
          '<div class="actions"><button class="btn block" data-a="rename">Save name</button><button class="btn secondary block" data-a="test">✉️ Send a test message here</button>' +
          (thread !== 0 ? '<button class="btn danger block" data-a="delete">Remove from list</button>' : "") + "</div>",
          function (sheet, close) { on(sheet, "[data-a]", "click", function (e2) { close({ a: e2.currentTarget.dataset.a, name: sheet.querySelector("[data-name]").value.trim() }); }); });
        if (!a) return;
        try {
          if (a.a === "rename") { if (!a.name) return toast("Enter a name", "err"); await api("PATCH", "/setup/topics/" + chat + "/" + thread, { name: a.name }); }
          else if (a.a === "test") { await api("POST", "/setup/test-message", { chat_id: chat, thread_id: thread }); }
          else if (a.a === "delete") { await api("DELETE", "/setup/topics/" + chat + "/" + thread); }
          haptic("success"); toast("Done", "ok"); refresh();
        } catch (err) { fail(err); }
      });
      on(content, "[data-admin]", "click", async function (e) {
        var id = Number(e.currentTarget.dataset.admin);
        if (!(await confirmDialog("Remove admin " + id + "?"))) return;
        try { await api("DELETE", "/setup/admins/" + id); toast("Removed", "ok"); refresh(); } catch (err) { fail(err); }
      });
    },
  };

  views.audit = {
    title: function () { return "Audit log"; },
    action: function () { return { label: "↻", onClick: refresh }; },
    render: async function (content, params, alive) {
      var d = await api("GET", "/audit?limit=100");
      if (!alive()) return;
      content.innerHTML = d.items.length ? '<div class="list">' + d.items.map(function (r) {
        var det = r.details ? Object.keys(r.details).filter(function (k) { return k !== "via"; }).map(function (k) { return k + "=" + (typeof r.details[k] === "object" ? JSON.stringify(r.details[k]) : r.details[k]); }).join(", ") : "";
        return '<div class="row static"><div class="main"><div class="title">' + esc(r.action.replace(/_/g, " ")) + '</div><div class="meta">' + esc(r.created_at_local) + " · by " + esc(r.actor) + (r.details && r.details.via ? " via " + esc(r.details.via) : "") + "</div>" +
          (det ? '<div class="meta">' + esc(det) + "</div>" : "") + "</div></div>";
      }).join("") + "</div>" : '<div class="card"><p class="empty">No entries yet.</p></div>';
    },
  };

  // ---------------------------------------------------------------- MEMBER: register
  views.register = {
    title: function () { return "ESA Assembly Voting"; },
    render: async function (content, params) {
      content.innerHTML = '<div class="card"><h2>👋 Welcome</h2><p>Register once with the credentials issued to you by the National Office. ' +
        "Your Telegram account is then linked to your voting token.</p></div>" +
        '<div class="card"><div class="field"><label>Voting Token ID</label><input type="text" data-token autocapitalize="characters" autocomplete="off" placeholder="ESA-2026-K7M2P"></div>' +
        '<div class="field"><label>Password</label><input type="password" data-pass autocomplete="off" placeholder="from your credential slip"></div>' +
        '<p class="err hint" data-err hidden></p></div>' +
        '<button class="btn block" data-go>Register</button>' +
        '<p class="hint">Five wrong passwords lock the token for a while. Problems? Contact the National Office.</p>';
      var errEl = content.querySelector("[data-err]");
      var MSG = {
        unknown_token: "That token was not recognized. Check for typos (letters O/0 and I/1 are never used).",
        conflict: "This token is already registered to another Telegram account. Contact the National Office if this is an error.",
        locked: "This token is temporarily locked after too many failed attempts. Try again later.",
        wrong_password: "Wrong password. Please check your credential slip and try again.",
        locked_now: "Wrong password — the token is now locked for a while.",
      };
      content.querySelector("[data-go]").onclick = async function () {
        var token = content.querySelector("[data-token]").value.trim().toUpperCase();
        var pass = content.querySelector("[data-pass]").value;
        errEl.hidden = true;
        if (!token || !pass) { errEl.textContent = "Enter both your token and password."; errEl.hidden = false; return; }
        this.disabled = true;
        try {
          var r = await api("POST", "/register", { token: token, password: pass });
          if (r.status === "ok") {
            haptic("success");
            state.me = await api("GET", "/me");
            toast("Registered as " + (r.member.full_name || r.member.token_id), "ok");
            go("ballots", { focus: params.focus }, { root: true });
            return;
          }
          haptic("error");
          errEl.textContent = (MSG[r.status] || "Registration failed.") + (r.status === "locked_now" || r.status === "locked" ? " (" + r.lock_minutes + " minutes)" : "");
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
      '<p class="hint">' + (e.anonymous ? "🔒 Secret ballot — your choice is anonymous and final." : "✏️ Open ballot — you may change your vote until voting closes.") +
      (e.closes_at_local ? "<br>⏰ Closes " + esc(e.closes_at_local) : "") + "</p>";
    if (e.voted && e.anonymous) {
      html += '<div class="verdict">☑️ Your ballot has been recorded. Thank you!</div>';
    } else {
      if (e.voted) html += '<p class="small">Your current vote: <b>' + esc(e.options[e.my_choice] || "—") + "</b></p>";
      html += '<div class="options">' + e.options.map(function (o, i) {
        return '<button class="opt' + (e.voted && e.my_choice === i ? " chosen" : "") + '" data-vote="' + e.id + ":" + i + '"><span>' + esc(o) + "</span>" + (e.voted && e.my_choice === i ? "<span>✓</span>" : "") + "</button>";
      }).join("") + "</div>";
    }
    return html + "</div>";
  }

  async function castVote(res, i) {
    var opt = res.options[i];
    var msg = "Vote “" + opt + "” on " + res.code + "?" + (res.anonymous ? "\n\nThis is a secret ballot: once confirmed, your vote is final." : "");
    if (!(await confirmDialog(msg))) return;
    try {
      var r = await api("POST", "/vote", { resolution_id: res.id, choice_index: i });
      if (r.result === "ok") { haptic("success"); await alertDialog(res.anonymous ? "✅ Ballot recorded. Thank you!" : "✅ Your vote for “" + r.option + "” is recorded. You may change it until voting closes."); }
      else if (r.result === "changed") { haptic("success"); toast("Vote changed to " + r.option, "ok"); }
      else if (r.result === "already_voted") { haptic("warning"); await alertDialog("You have already voted on this secret ballot; votes cannot be changed."); }
      else if (r.result === "not_open") { haptic("warning"); await alertDialog("Voting is not open for this resolution."); }
      else { haptic("error"); toast("Could not record your vote. Please try again.", "err"); }
      refresh();
    } catch (err) { fail(err); }
  }

  views.ballots = {
    title: function () { return "Vote"; },
    action: function () { return { label: "↻", onClick: refresh }; },
    render: async function (content, params, alive) {
      var d = await api("GET", "/ballots");
      if (!alive()) return;
      var html = "";
      if (d.member) html += '<p class="hint">Registered as <b>' + esc(d.member.full_name || d.member.token_id) + "</b></p>";
      if (!d.open.length) {
        html += '<div class="card"><p class="empty">No resolutions are open for voting right now.' + (d.drafts ? " " + plural(d.drafts, "resolution") + " being prepared." : "") + "</p></div>";
      } else {
        d.open.forEach(function (e) { html += ballotCard(e); });
      }
      if (d.closed.length) html += '<div class="section-title">Recent results</div><div class="list">' + d.closed.slice(0, 3).map(function (e) {
        return '<button class="row" data-r="' + e.id + '"><div class="main"><div class="title">' + esc(e.code) + " — " + esc(e.title) + '</div><div class="meta">' +
          (e.outcome && e.outcome.adopted ? "✅ Adopted: " + esc(e.outcome.winner) : e.outcome && !e.outcome.quorumMet ? "⚠️ Quorum not reached" : "❌ Not adopted") + " · " + plural(e.ballots, "ballot") + '</div></div><span class="chev">›</span></button>';
      }).join("") + "</div>";
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
    title: function () { return "Results"; },
    action: function () { return { label: "↻", onClick: refresh }; },
    render: async function (content, params, alive) {
      var d = await api("GET", "/ballots");
      if (!alive()) return;
      content.innerHTML = d.closed.length ? '<div class="list">' + d.closed.map(function (e) {
        return '<button class="row" data-r="' + e.id + '"><div class="main"><div class="title">' + esc(e.code) + " — " + esc(e.title) + '</div><div class="meta">' +
          (e.outcome && e.outcome.adopted ? "✅ Adopted: " + esc(e.outcome.winner) : e.outcome && !e.outcome.quorumMet ? "⚠️ Quorum not reached" : "❌ Not adopted") + " · " + plural(e.ballots, "ballot") + (e.closed_at_local ? " · " + esc(e.closed_at_local) : "") + '</div></div><span class="chev">›</span></button>';
      }).join("") + "</div>" : '<div class="card"><p class="empty">No results published yet. Results appear here when voting on a resolution closes.</p></div>';
      on(content, "[data-r]", "click", function (ev) { go("results", { id: ev.currentTarget.dataset.r }); });
    },
  };

  views.results = {
    title: function () { return "Results"; },
    render: async function (content, params, alive) {
      var e = await api("GET", "/results/" + params.id);
      if (!alive()) return;
      content.innerHTML = '<div class="card"><h2>' + esc(e.code) + " — " + esc(e.title) + "</h2><div>" + statusBadge(e.status) + "</div>" +
        (e.description ? "<p>" + esc(e.description) + "</p>" : "") + '<p class="hint">' + resolutionMeta(e) + (e.closed_at_local ? " · closed " + esc(e.closed_at_local) : "") + "</p></div>" +
        '<div class="card"><h3>' + (e.status === "closed" ? "Final results" : "Interim results") + "</h3>" + resultsHtml(e) + "</div>";
    },
  };

  views.me = {
    title: function () { return "My registration"; },
    render: async function (content) {
      var m = state.me.member;
      content.innerHTML = '<div class="card"><h2>' + esc(m.full_name || m.token_id) + '</h2><dl class="kv"><dt>Token</dt><dd><code>' + esc(m.token_id) + "</code></dd>" +
        (m.region ? "<dt>Region</dt><dd>" + esc(m.region) + "</dd>" : "") +
        "<dt>Registered</dt><dd>" + (m.registered_at ? new Date(m.registered_at).toLocaleString() : "—") + "</dd>" +
        "<dt>Telegram</dt><dd>" + esc(state.me.user.first_name + (state.me.user.last_name ? " " + state.me.user.last_name : "")) + "</dd></dl></div>" +
        '<div class="card"><h3>How voting works</h3><p class="small">Open resolutions appear under <b>Vote</b>. Tap an option and confirm. ' +
        "On a <b>secret ballot</b> your choice is stored without your name and cannot be changed. On an <b>open ballot</b> you may change your vote until voting closes. " +
        "Results are published when voting closes.</p><p class=\"small\">Lost your phone or changed account? Ask the National Office to detach your token; you can then register again with the same credentials.</p></div>";
    },
  };

  // ---------------------------------------------------------------- boot
  function parseStart() {
    var q = new URLSearchParams(location.search).get("r");
    var sp = tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param;
    if (sp && /^(vote_|r_)/.test(sp)) sp = sp.replace(/^(vote_|r_)/, "");
    var id = q || sp || null;
    return id && /^[0-9a-f-]{36}$/.test(id) ? id : null;
  }

  async function boot() {
    if (!tg || !tg.initData) {
      app.innerHTML = '<div class="screen-center"><h2>Open in Telegram</h2><p class="hint">This page only works inside the Telegram app. Open the voting bot in Telegram and tap the menu button next to the message box.</p></div>';
      return;
    }
    try { tg.ready(); tg.expand(); } catch (_) { /* ignore */ }
    try { tg.setHeaderColor("secondary_bg_color"); tg.setBackgroundColor("secondary_bg_color"); } catch (_) { /* older clients */ }
    try { tg.BackButton.onClick(back); } catch (_) { /* ignore */ }
    try { tg.disableVerticalSwipes(); } catch (_) { /* ignore */ }

    try {
      state.me = await api("GET", "/me");
    } catch (err) {
      app.innerHTML = '<div class="screen-center"><h2>Could not sign in</h2><p class="hint">' + esc(err.message) + '</p><button class="btn" data-retry>Retry</button></div>';
      app.querySelector("[data-retry]").onclick = boot;
      return;
    }
    var focus = parseStart();
    if (state.me.role === "admin") {
      if (focus && state.me.member) go("ballots", { focus: focus }, { root: true });
      else go("home", {}, { root: true });
    } else if (state.me.role === "member") {
      go("ballots", { focus: focus }, { root: true });
    } else {
      go("register", { focus: focus }, { root: true });
    }
  }

  boot();
})();
