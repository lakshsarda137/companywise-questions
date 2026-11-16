"use strict";
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  const REC_LABEL = ["30 days", "3 months", "6 months", "6+ months", "All time"];
  const REC_SHORT = ["30d", "3mo", "6mo", "6mo+", "—"];
  const DIFF = ["Easy", "Medium", "Hard"];
  const HQS = ["US", "India", "Europe", "APAC", "Other"];
  const FOLDER = ["--f-red", "--f-blue", "--f-yellow", "--f-green", "--f-purple", "--f-orange"];
  const PAGE = 120;

  let D, P, C, byProblem, compIndex;
  const solved = new Set(store.get("cwq.solved", []));

  // ---------------- state (mirrored in URL hash) ----------------
  const blank = () => ({ q: "", sec: [], co: [], hq: [], diff: [], top: [], rec: 4, newd: 0, minc: 1, hide: 0, sort: "companies", dir: -1 });
  let S = blank();
  let view = "questions";

  function readHash() {
    const h = location.hash.replace(/^#\/?/, "");
    const [path, qs] = h.split("?");
    view = path === "companies" ? "companies" : path === "about" ? "about" : "questions";
    S = blank();
    const p = new URLSearchParams(qs || "");
    for (const [k, v] of p) {
      if (["sec", "co", "hq", "diff", "top"].includes(k)) S[k] = v.split(",").filter(Boolean);
      else if (["rec", "newd", "minc", "hide", "dir"].includes(k)) S[k] = +v;
      else if (k in S) S[k] = v;
    }
  }
  function writeHash() {
    const p = new URLSearchParams(); const b = blank();
    for (const k of Object.keys(S)) {
      const v = S[k];
      if (Array.isArray(v) ? v.length : v !== b[k]) p.set(k, Array.isArray(v) ? v.join(",") : v);
    }
    const qs = p.toString().replace(/%2C/g, ",");
    const next = "#/" + (view === "questions" ? "" : view) + (qs ? "?" + qs : "");
    if (location.hash !== next) history.replaceState(null, "", next);
  }

  // ---------------- data ----------------
  async function load() {
    const res = await fetch("data/questions.json", { cache: "no-cache" });
    D = await res.json();
    P = D.problems; C = D.companies;
    byProblem = Array.from({ length: P.length }, () => []);
    const pp = D.pairs.p;
    for (let i = 0; i < pp.length; i++) byProblem[pp[i]].push(i);
    compIndex = new Map(C.map((c, i) => [c[0], i]));
    const d = new Date(D.generated);
    $("#updated").textContent = "Updated " + d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  // ---------------- filtering ----------------
  function companyMask() {
    const co = new Set(S.co), sec = new Set(S.sec.map(Number)), hq = new Set(S.hq);
    const unc = sec.has(-1);
    return C.map((c) =>
      (!co.size || co.has(c[0])) &&
      (!sec.size || c[2].some((s) => sec.has(s)) || (unc && !c[2].length)) &&
      (!hq.size || hq.has(c[3])));
  }
  function newCutoff() {
    if (!S.newd) return 0;
    if (S.newd < 0) return 1;                       // anything since tracking started
    const cut = new Date(Date.now() - S.newd * 864e5).toISOString().slice(0, 10);
    const i = D.days.findIndex((d) => d >= cut);
    return i < 0 ? Infinity : i + 1;
  }
  function compute() {
    const mask = companyMask();
    const cut = newCutoff();
    const { c: pc, r: pr, f: pf, n: pn } = D.pairs;
    const diffs = new Set(S.diff.map(Number)), tops = new Set(S.top.map(Number));
    const q = S.q.trim().toLowerCase().replace(/^#(?=\d)/, "");
    const out = [];
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      if (diffs.size && !diffs.has(p[3])) continue;
      if (tops.size && !p[5].some((t) => tops.has(t))) continue;
      if (S.hide && solved.has(p[1])) continue;
      if (q && !(p[2].toLowerCase().includes(q) || String(p[0]) === q)) continue;
      let n = 0, f = 0, r = 9, nw = 0, fs = 0;
      for (const j of byProblem[i]) {
        if (!mask[pc[j]] || pr[j] > S.rec || (cut && pn[j] < cut)) continue;
        n++; fs += pf[j]; if (pr[j] < r) r = pr[j]; if (pn[j] > nw) nw = pn[j];
      }
      f = n ? fs / n : 0;
      if (n < Math.max(1, S.minc)) continue;
      out.push({ i, n, f, r, nw });
    }
    const k = S.sort, dir = S.dir;
    const key = {
      companies: (a) => a.n * 1000 + a.f,
      freq: (a) => a.f * 10000 + a.n,
      recent: (a) => -a.r * 10000 + a.n,
      diff: (a) => P[a.i][3] * 10000 + a.n,
      acc: (a) => P[a.i][4] ?? -1,
      title: null,
      id: (a) => P[a.i][0],
    }[k];
    if (k === "title") out.sort((a, b) => dir * P[b.i][2].localeCompare(P[a.i][2]));
    else out.sort((a, b) => dir * (key(a) - key(b)) || P[a.i][0] - P[b.i][0]);
    return { rows: out, mask };
  }

  // ---------------- filter bar ----------------
  const FILTERS = [
    { key: "sec", label: "Sector" },
    { key: "co", label: "Company" },
    { key: "diff", label: "Difficulty" },
    { key: "top", label: "Topic" },
    { key: "rec", label: "Asked" },
    { key: "more", label: "More" },
  ];
  function filterActive(k) {
    if (k === "rec") return S.rec !== 4;
    if (k === "more") return S.hq.length || S.newd || S.minc > 1 || S.hide;
    return S[k].length > 0;
  }
  function renderFilterBar() {
    $("#filters").innerHTML = FILTERS.map(({ key, label }) => {
      let txt = label;
      if (key === "rec" && S.rec !== 4) txt = "Asked ≤ " + REC_SHORT[S.rec];
      else if (key === "diff" && S.diff.length) txt = S.diff.map((d) => DIFF[d]).join(", ");
      else if (key !== "rec" && key !== "more" && S[key].length) txt = `${label} · ${S[key].length}`;
      return `<button class="fbtn ${filterActive(key) ? "on" : ""}" data-f="${key}">${esc(txt)}<span class="caret">▼</span></button>`;
    }).join("");
  }

  function chips() {
    const c = [];
    for (const s of S.sec) c.push(["sec", s, s === "-1" ? "Unclassified" : D.sectors[s]]);
    for (const s of S.co) c.push(["co", s, (C[compIndex.get(s)] || [, s])[1]]);
    for (const s of S.diff) c.push(["diff", s, DIFF[s]]);
    for (const s of S.top) c.push(["top", s, D.topics[s]]);
    for (const s of S.hq) c.push(["hq", s, "HQ " + s]);
    if (S.rec !== 4) c.push(["rec", "", "Asked in last " + REC_LABEL[S.rec]]);
    if (S.newd) c.push(["newd", "", S.newd < 0 ? "New since tracking" : `New in ${S.newd}d`]);
    if (S.minc > 1) c.push(["minc", "", `≥ ${S.minc} companies`]);
    if (S.hide) c.push(["hide", "", "Hiding solved"]);
    if (S.q) c.push(["q", "", `“${S.q}”`]);
    if (!c.length) return "";
    return c.map(([k, v, l]) => `<button class="chip" data-k="${k}" data-v="${esc(v)}" title="Remove">${esc(l)} ×</button>`).join("") +
      `<button class="linkbtn" id="reset">Reset</button>`;
  }
  function removeChip(k, v) {
    const b = blank();
    if (Array.isArray(S[k])) S[k] = S[k].filter((x) => x !== v);
    else S[k] = b[k];
    if (k === "q") $("#q").value = "";
    update();
  }

  // ---------------- popovers ----------------
  const pop = $("#pop");
  let popKey = null;
  function closePop() { pop.hidden = true; popKey = null; }
  function openPop(btn, key) {
    if (popKey === key) return closePop();
    popKey = key;
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.min(r.left + scrollX, innerWidth - 296) + "px";
    pop.style.top = r.bottom + scrollY + 4 + "px";
    pop.hidden = false;
    renderPop();
    const inp = $("input[type=search]", pop); if (inp && matchMedia("(pointer:fine)").matches) inp.focus();
  }
  function optList(key, items, filterText = "") {
    const sel = new Set(S[key]);
    const ft = filterText.toLowerCase();
    return items.filter((it) => !ft || it.label.toLowerCase().includes(ft)).slice(0, 300).map((it) =>
      `<label><input type="checkbox" class="check" data-k="${key}" value="${esc(it.value)}" ${sel.has(String(it.value)) ? "checked" : ""}>` +
      `${it.icon || ""}<span>${esc(it.label)}</span><span class="n">${it.n ?? ""}</span></label>`).join("") || `<div class="empty" style="padding:16px">No matches</div>`;
  }
  function radioList(key, items) {
    return items.map(([v, l]) => `<label><input type="radio" name="${key}" data-k="${key}" value="${v}" ${String(S[key]) === String(v) ? "checked" : ""}><span>${esc(l)}</span></label>`).join("");
  }
  function popItems(key) {
    if (key === "sec") {
      const n = D.sectors.map(() => 0); let unc = 0;
      for (const c of C) { c[2].forEach((s) => n[s]++); if (!c[2].length) unc++; }
      const items = D.sectors.map((s, i) => ({ value: i, label: s, n: n[i], icon: folderIcon(i) }))
        .sort((a, b) => b.n - a.n);
      if (unc) items.push({ value: -1, label: "Unclassified", n: unc, icon: folderIcon(-1) });
      return items;
    }
    if (key === "co") {
      const secs = new Set(S.sec.map(Number));
      return C.filter((c) => !secs.size || c[2].some((s) => secs.has(s)))
        .map((c) => ({ value: c[0], label: c[1] + (c[5] ? " ?" : ""), n: c[4] }))
        .sort((a, b) => S.co.includes(b.value) - S.co.includes(a.value) || b.n - a.n);
    }
    if (key === "top") {
      const n = D.topics.map(() => 0);
      for (const p of P) p[5].forEach((t) => n[t]++);
      return D.topics.map((t, i) => ({ value: i, label: t, n: n[i] })).sort((a, b) => b.n - a.n);
    }
    if (key === "diff") {
      const n = [0, 0, 0]; for (const p of P) if (p[3] >= 0) n[p[3]]++;
      return DIFF.map((d, i) => ({ value: i, label: d, n: n[i] }));
    }
    if (key === "hq") {
      const n = {}; for (const c of C) n[c[3]] = (n[c[3]] || 0) + 1;
      return HQS.map((h) => ({ value: h, label: h, n: n[h] || 0 }));
    }
    return [];
  }
  function renderPop(keepSearch) {
    const key = popKey; if (!key) return;
    const ft = keepSearch ?? "";
    let html = "";
    if (["sec", "co", "top"].includes(key)) {
      const ph = { sec: "Filter sectors…", co: S.sec.length ? "Companies in selected sectors…" : "Search 689 companies…", top: "Filter topics…" }[key].replace("689", C.length);
      html = `<input type="search" placeholder="${ph}" value="${esc(ft)}"><div class="opts">${optList(key, popItems(key), ft)}</div>` +
        `<div class="foot"><span class="muted">${S[key].length} selected</span><button class="linkbtn" data-clear="${key}">Clear</button></div>`;
    } else if (key === "diff") {
      html = `<div class="opts">${optList("diff", popItems("diff"))}</div>`;
    } else if (key === "rec") {
      html = `<h4>Asked within</h4><div class="opts">${radioList("rec", REC_LABEL.map((l, i) => [i, i === 4 ? "Any time" : "Last " + l]))}</div>`;
    } else if (key === "more") {
      const since = D.trackingSince;
      html = `<div class="opts">
        <h4>Newly added to the repos</h4>${radioList("newd", [[0, "Off"], [1, "Last 24 hours"], [7, "Last 7 days"], [30, "Last 30 days"], [-1, "Any since " + since]])}
        <div class="sep"></div><h4>Asked by at least</h4>${radioList("minc", [[1, "1 company"], [3, "3 companies"], [10, "10 companies"], [25, "25 companies"]])}
        <div class="sep"></div><h4>Company HQ</h4>${optList("hq", popItems("hq"))}
        <div class="sep"></div><label><input type="checkbox" class="check" data-toggle="hide" ${S.hide ? "checked" : ""}><span>Hide questions I've solved</span></label>
      </div>`;
    }
    pop.innerHTML = html;
  }
  pop.addEventListener("input", (e) => {
    const t = e.target;
    if (t.type === "search") {
      const opts = $(".opts", pop); opts.innerHTML = optList(popKey, popItems(popKey), t.value);
    }
  });
  pop.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.toggle) { S[t.dataset.toggle] = t.checked ? 1 : 0; update(false); return; }
    const k = t.dataset.k; if (!k) return;
    if (t.type === "radio") S[k] = +t.value;
    else {
      const v = String(t.value);
      S[k] = t.checked ? [...new Set([...S[k], v])] : S[k].filter((x) => x !== v);
    }
    update(false);
    const foot = $(".foot .muted", pop); if (foot) foot.textContent = S[k].length + " selected";
  });
  pop.addEventListener("click", (e) => {
    const k = e.target.dataset.clear;
    if (k) { S[k] = []; update(false); renderPop($("input[type=search]", pop)?.value); }
  });
  document.addEventListener("mousedown", (e) => {
    if (!pop.hidden && !pop.contains(e.target) && !e.target.closest(".fbtn")) closePop();
  });

  function folderIcon(i) {
    const v = i < 0 ? "--faint" : FOLDER[i % FOLDER.length];
    return `<span class="folder" style="--fc:var(${v})"></span>`;
  }

  // ---------------- questions table ----------------
  let current = [], shown = 0, curMask = null;
  const open = new Set();
  const HEAD = [
    ["", "c-check"], ["", "c-tri"], ["Name", "c-name", "title"], ["Level", "c-diff", "diff"], ["Topics", "c-topics"],
    ["Companies", "c-co num", "companies"], ["Avg freq", "c-freq num", "freq"], ["Last asked", "c-rec num", "recent"],
  ];
  function renderHead() {
    $("#thead").innerHTML = HEAD.map(([l, cls, k]) =>
      k ? `<span class="${cls}"><button data-sort="${k}" class="${S.sort === k ? "on" : ""}">${l}${S.sort === k ? (S.dir < 0 ? " ↓" : " ↑") : ""}</button></span>` : `<span class="${cls}">${l}</span>`).join("");
  }
  function rowHTML(o) {
    const p = P[o.i]; const isS = solved.has(p[1]);
    const tops = p[5].slice(0, 3).map((t) => D.topics[t]).join(", ");
    const isNew = o.nw > 0 && D.days.length && newCutoffDays(7) <= o.nw;
    const isOpen = open.has(o.i);
    return `<div class="row ${isS ? "solved" : ""} ${isOpen ? "open" : ""}" data-i="${o.i}">
      <input type="checkbox" class="check" data-solve="${esc(p[1])}" ${isS ? "checked" : ""} aria-label="Mark solved">
      <button class="tri" aria-label="Show companies" aria-expanded="${isOpen}">${isOpen ? "▼" : "▶"}</button>
      <span class="name"><span class="id">${p[0] || ""}</span><a href="https://leetcode.com/problems/${esc(p[1])}/" target="_blank" rel="noopener">${esc(p[2])}</a>${isNew ? '<span class="new">NEW</span>' : ""}</span>
      <span class="d${p[3]}">${DIFF[p[3]] || "—"}</span>
      <span class="topics" title="${esc(p[5].map((t) => D.topics[t]).join(", "))}">${esc(tops)}</span>
      <span class="num">${o.n}</span>
      <span class="num freq">${o.f ? Math.round(o.f) + "%" : "—"}</span>
      <span class="num rec">${REC_SHORT[o.r] ?? "—"}</span>
    </div>${isOpen ? detailHTML(o.i) : ""}`;
  }
  const _ncache = {};
  function newCutoffDays(d) {
    if (_ncache[d] != null) return _ncache[d];
    const cut = new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
    const i = D.days.findIndex((x) => x >= cut);
    return (_ncache[d] = i < 0 ? Infinity : i + 1);
  }
  function detailHTML(i) {
    const { c: pc, r: pr, f: pf } = D.pairs;
    const list = byProblem[i].map((j) => ({ c: pc[j], r: pr[j], f: pf[j], in: curMask[pc[j]] && pr[j] <= S.rec }))
      .sort((a, b) => b.in - a.in || a.r - b.r || b.f - a.f);
    return `<div class="detail">${list.map((x) => {
      const c = C[x.c];
      return `<div class="drow ${x.in ? "" : "out"}">${folderIcon(c[2][0] ?? -1)}<button data-co="${esc(c[0])}" title="Filter to ${esc(c[1])}">${esc(c[1])}</button>` +
        `<span class="secs">${esc(c[2].map((s) => D.sectors[s]).join(" · ") || "Unclassified")}</span>` +
        `<span class="num">${REC_LABEL[x.r]}</span><span class="num">${x.f ? Math.round(x.f) + "%" : "—"}</span></div>`;
    }).join("")}</div>`;
  }
  function renderRows(reset = true) {
    const host = $("#rows");
    if (reset) { shown = 0; host.innerHTML = ""; }
    if (!current.length) { host.innerHTML = `<div class="empty">No questions match these filters.</div>`; return; }
    const next = current.slice(shown, shown + PAGE);
    host.insertAdjacentHTML("beforeend", next.map(rowHTML).join(""));
    shown += next.length;
  }
  new IntersectionObserver((es) => { if (es[0].isIntersecting && view === "questions" && shown < current.length) renderRows(false); }, { rootMargin: "600px" }).observe($("#sentinel"));

  function update(scrollTop = true) {
    writeHash();
    renderFilterBar();
    const { rows, mask } = compute();
    current = rows; curMask = mask;
    const nComp = mask.filter(Boolean).length;
    $("#count").textContent = `${rows.length.toLocaleString()} questions` + (nComp < C.length ? ` · ${nComp} companies` : "");
    $("#chips").innerHTML = chips();
    renderHead();
    renderRows();
    if (scrollTop && scrollY > 200) scrollTo({ top: 0 });
  }

  // events: questions view
  let qt;
  $("#q").addEventListener("input", (e) => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value; update(false); }, 120); });
  $("#filters").addEventListener("click", (e) => { const b = e.target.closest(".fbtn"); if (b) openPop(b, b.dataset.f); });
  $("#chips").addEventListener("click", (e) => {
    if (e.target.id === "reset") { S = blank(); $("#q").value = ""; open.clear(); update(); return; }
    const c = e.target.closest(".chip"); if (c) removeChip(c.dataset.k, c.dataset.v);
  });
  $("#thead").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-sort]"); if (!b) return;
    const k = b.dataset.sort;
    if (S.sort === k) S.dir = -S.dir; else { S.sort = k; S.dir = ["title", "diff", "recent"].includes(k) ? (k === "recent" ? -1 : 1) : -1; }
    update(false);
  });
  $("#rows").addEventListener("click", (e) => {
    const co = e.target.closest("button[data-co]");
    if (co) { S.co = [co.dataset.co]; update(); return; }
    const sv = e.target.closest("[data-solve]");
    if (sv) {
      const s = sv.dataset.solve; sv.checked ? solved.add(s) : solved.delete(s);
      store.set("cwq.solved", [...solved]); sv.closest(".row").classList.toggle("solved", sv.checked);
      return;
    }
    const row = e.target.closest(".row");
    if (!row || e.target.closest("a")) return;
    const i = +row.dataset.i;
    open.has(i) ? open.delete(i) : open.add(i);
    const o = current.find((x) => x.i === i);
    const nextEl = row.nextElementSibling;
    if (nextEl && nextEl.classList.contains("detail")) nextEl.remove();
    row.outerHTML = rowHTML(o);
  });

  // ---------------- companies view ----------------
  const openSec = new Set(store.get("cwq.openSec", []));
  function renderCompanies() {
    const q = $("#cq").value.trim().toLowerCase();
    const r30 = new Array(C.length).fill(0);
    D.pairs.r.forEach((r, j) => { if (r === 0) r30[D.pairs.c[j]]++; });
    const groups = D.sectors.map((s, i) => ({ i, name: s, cs: [] }));
    const unc = { i: -1, name: "Unclassified", cs: [] };
    C.forEach((c, ci) => {
      if (q && !c[1].toLowerCase().includes(q) && !c[0].includes(q)) return;
      if (!c[2].length) unc.cs.push(ci); else c[2].forEach((s) => groups[s].cs.push(ci));
    });
    if (unc.cs.length) groups.push(unc);
    const vis = groups.filter((g) => g.cs.length).sort((a, b) => b.cs.length - a.cs.length);
    const shownCos = new Set(vis.flatMap((g) => g.cs));
    $("#ccount").textContent = `${vis.length} sectors · ${shownCos.size} companies`;
    $("#crows").innerHTML = vis.map((g) => {
      const isOpen = q || openSec.has(g.i);
      const qs = g.cs.reduce((a, ci) => a + C[ci][4], 0);
      const head = `<div class="crow sector" data-sec="${g.i}"><span class="nm"><span style="width:12px;font-size:12px">${isOpen ? "▼" : "▶"}</span>${folderIcon(g.i)}<span>${esc(g.name)}</span></span>` +
        `<span class="secs">Folder</span><span class="hq"></span><span class="num">${g.cs.length} items</span><span class="num"></span></div>`;
      if (!isOpen) return head;
      const cos = g.cs.sort((a, b) => C[b][4] - C[a][4]).map((ci) => {
        const c = C[ci];
        return `<div class="crow co" data-co="${esc(c[0])}"><span class="nm"><span>${esc(c[1])}${c[5] ? '<span class="low" title="Low-confidence classification">?</span>' : ""}</span></span>` +
          `<span class="secs">${esc(c[2].map((s) => D.sectors[s]).join(" · ") || "—")}</span><span class="hq">${esc(c[3] || "")}</span>` +
          `<span class="num">${c[4]}</span><span class="num">${r30[ci] || ""}</span></div>`;
      }).join("");
      return head + cos;
    }).join("") || `<div class="empty">No companies match.</div>`;
  }
  $("#cq").addEventListener("input", renderCompanies);
  $("#crows").addEventListener("click", (e) => {
    const co = e.target.closest(".crow.co");
    if (co) { S = blank(); S.co = [co.dataset.co]; S.sort = "freq"; go("questions"); return; }
    const sec = e.target.closest(".crow.sector");
    if (sec) {
      const i = +sec.dataset.sec;
      openSec.has(i) ? openSec.delete(i) : openSec.add(i);
      store.set("cwq.openSec", [...openSec]); renderCompanies();
    }
  });

  // ---------------- about ----------------
  function renderAbout() {
    const s = D.sources;
    $("#about").innerHTML = `
      <p>Every LeetCode question that companies have been reported to ask, merged from two open datasets and refreshed daily.</p>
      <h3>Sources</h3>
      <p><a href="${s.codejeet.url}" target="_blank" rel="noopener">ayush-that/codejeet</a>, commit <code>${esc(s.codejeet.sha || "?")}</code> (${esc(s.codejeet.date || "?")})<br>
      <a href="${s.sneh.url}" target="_blank" rel="noopener">snehasishroy/leetcode-companywise-interview-questions</a>, commit <code>${esc(s.sneh.sha || "?")}</code> (${esc(s.sneh.date || "?")})</p>
      <h3>How to read it</h3>
      <p><b>Companies</b>: how many companies (within your filters) asked the question. <b>Avg freq</b>: LeetCode's frequency score (100% = that company's most-asked question), averaged over the matching companies. <b>Last asked</b>: the most recent bucket any of them reported it in (30 days, 3 months, 6 months, or older).</p>
      <p><b>New</b>: a company and question pair that showed up in the repos after ${esc(D.trackingSince)}, when tracking started. Neither repo records when a question was added, so this compares each day's data against the day before.</p>
      <p><b>Sectors</b> were assigned per company by Claude Sonnet, which used web search to check uncertain cases. A company can be in more than one sector. A <span class="low">?</span> marks a low-confidence classification.</p>
      <p>Your solved checkmarks are stored only in this browser.</p>
      <p class="muted">${C.length} companies · ${P.length.toLocaleString()} questions · ${D.pairs.c.length.toLocaleString()} company–question pairs · built ${esc(D.generated)}</p>`;
  }

  // ---------------- view switching ----------------
  function go(v) { view = v; showView(); }
  function showView() {
    closePop();
    for (const v of ["questions", "companies", "about"]) $("#view-" + v).hidden = v !== view;
    document.querySelectorAll(".menubar nav a").forEach((a) => a.classList.toggle("on", a.dataset.view === view));
    $("#win-title").textContent = { questions: "Questions", companies: "Companies", about: "About" }[view];
    if (view === "questions") { $("#q").value = S.q; update(); }
    else { writeHash(); if (view === "companies") renderCompanies(); else renderAbout(); scrollTo({ top: 0 }); }
  }
  document.querySelectorAll(".menubar nav a").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault(); if (a.dataset.view === "questions" && view === "questions") return; go(a.dataset.view);
  }));
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePop();
    if (e.key === "/" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault(); const el = view === "companies" ? $("#cq") : $("#q"); el.focus();
    }
  });

  // ---------------- ascii backdrop ----------------
  function ascii() {
    const el = $("#ascii"), ch = " .:-=+*#";
    const cols = Math.ceil(innerWidth / 5.4), rows = Math.ceil(innerHeight * 0.55 / 9);
    let s = "";
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const v = Math.sin(x * 0.045 + Math.sin(y * 0.11) * 2) + Math.sin(y * 0.09 - x * 0.02) + Math.sin((x + y) * 0.03);
        const fade = y / rows;
        const k = Math.max(0, Math.min(ch.length - 1, Math.floor(((v + 3) / 6) * ch.length * fade * 1.15)));
        s += ch[k];
      }
      s += "\n";
    }
    el.textContent = s;
  }

  // ---------------- boot ----------------
  const savedTheme = store.get("cwq.theme", null);
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  $("#theme").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next; store.set("cwq.theme", next);
  });
  ascii(); let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(ascii, 200); });
  load().then(() => { readHash(); showView(); }).catch((err) => {
    $("#count").textContent = "Couldn't load data/questions.json: " + err.message;
  });
})();
