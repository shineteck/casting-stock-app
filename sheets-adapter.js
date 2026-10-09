/*
 * スプレッドシート連携アダプタ
 * 元の画面が使っている claude.use("db") / claude.use("downloads") を
 * Google Apps Script（スプレッドシート）とブラウザのダウンロードに置き換えます。
 */
(function () {
  const CFG = window.STK_CONFIG || {};
  const LS_KEY = "stk-api-url";
  const LS_TOK = "stk-token";

  function apiUrl() {
    if (CFG.apiUrl) return CFG.apiUrl;
    try { return localStorage.getItem(LS_KEY) || ""; } catch (e) { return ""; }
  }
  let memToken = "";
  function token() {
    try { return localStorage.getItem(LS_TOK) || memToken; } catch (e) { return memToken; }
  }

  /* ── 通信 ── */
  async function getAll() {
    const u = new URL(apiUrl());
    u.searchParams.set("t", Date.now());
    u.searchParams.set("token", token());
    const r = await fetch(u, { cache: "no-store" });
    const j = await r.json();
    if (!j.ok) { if (j.error === "unauthorized") relogin(); throw Object.assign(new Error(j.error), { code: j.error }); }
    return j.data;
  }
  async function post(body) {
    // text/plain にすると CORS のプリフライトが発生せず Apps Script に直接届く
    const r = await fetch(apiUrl(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ ...body, token: token() })
    });
    const j = await r.json();
    if (!j.ok) { if (j.error === "unauthorized") relogin(); throw Object.assign(new Error(j.error), { code: j.error }); }
    return j.data;
  }

  /* ── 取得データを元画面の形（ドキュメント／コレクション）に変換して配信 ── */
  const subs = { settings: [], stocktakes: [], months: [] };
  const last = { settings: null, stocktakes: null, months: null };

  function publish(data) {
    const months = {};
    for (const [d, c] of Object.entries(data.days || {})) {
      const m = d.slice(0, 7);
      (months[m] = months[m] || { days: {}, notes: {} }).days[d] = c;
    }
    for (const [ws, t] of Object.entries(data.notes || {})) {
      const m = ws.slice(0, 7);
      (months[m] = months[m] || { days: {}, notes: {} }).notes[ws] = t;
    }
    const views = {
      settings: data.settings ? { exists: true, data: () => data.settings } : { exists: false, data: () => undefined },
      stocktakes: { exists: true, data: () => ({ list: data.stocktakes || [] }) },
      months: { docs: Object.keys(months).sort().map(id => ({ id, data: () => months[id] })) }
    };
    const raw = { settings: data.settings, stocktakes: data.stocktakes, months };
    for (const k of Object.keys(subs)) {
      const sig = JSON.stringify(raw[k]);
      if (sig === last[k]) continue; // 変化がなければ再描画しない
      last[k] = sig;
      subs[k].forEach(s => { try { s.next(views[k]); } catch (e) { console.error(e); } });
    }
  }
  function fail(e) {
    for (const k of Object.keys(subs)) subs[k].forEach(s => s.error && s.error(e));
  }

  let timer = null, inflight = null, writeSeq = 0;
  function refresh() {
    if (!inflight) {
      const seq = writeSeq;
      // 取得中に書き込みが完了した場合、古い取得結果では上書きしない
      inflight = getAll().then(d => { if (seq === writeSeq) publish(d); }, e => { fail(e); throw e; }).finally(() => { inflight = null; });
    }
    return inflight;
  }
  function startPolling() {
    if (timer) return;
    refresh().catch(() => {});
    const sec = Math.max(10, +CFG.pollSeconds || 30);
    timer = setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, sec * 1000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh().catch(() => {}); });
  }

  /* 書き込みは順番に送る（同じセルへの連続入力の前後が入れ替わらないように） */
  let queue = Promise.resolve();
  function write(body) {
    const p = queue.then(() => post(body));
    queue = p.then(d => { writeSeq++; publish(d); }, () => {});
    return p.then(() => undefined);
  }

  function key(path) {
    if (path === "config/settings") return "settings";
    if (path === "config/stocktakes") return "stocktakes";
    if (path === "months") return "months";
    return null;
  }

  function sub(k, next, error) {
    const s = { next, error };
    subs[k].push(s);
    startPolling();
    return () => { subs[k] = subs[k].filter(x => x !== s); };
  }

  const db = {
    collection(path) {
      return { onSnapshot: (next, error) => sub(key(path), next, error) };
    },
    doc(path) {
      const k = key(path);
      const m = /^months\/(\d{4}-\d{2})$/.exec(path);
      return {
        onSnapshot: (next, error) => sub(k, next, error),
        set(data) {
          if (k === "settings") return write({ action: "setSettings", data });
          if (k === "stocktakes") return write({ action: "setStocktakes", list: data.list || [] });
          if (m) return write({ action: "setMonth", m: m[1], days: data.days || {}, notes: data.notes || {} });
          return Promise.reject(new Error("unsupported path " + path));
        },
        update(data) {
          if (m && data.days) {
            const jobs = [];
            for (const [date, cell] of Object.entries(data.days))
              for (const [ck, val] of Object.entries(cell))
                jobs.push(write({ action: "setCell", date, key: ck, val: val === undefined ? null : val }));
            return Promise.all(jobs).then(() => undefined);
          }
          if (m && data.notes) {
            const jobs = Object.entries(data.notes).map(([ws, text]) => write({ action: "setNote", ws, text: text || "" }));
            return Promise.all(jobs).then(() => undefined);
          }
          return this.set(data);
        }
      };
    }
  };

  /* ── CSV などのファイル保存 ── */
  const downloads = {
    async save({ filename, data, mimeType }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType || "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename || "download";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
  };

  /* ── 接続先・合言葉の入力画面 ── */
  function ask(needUrl, msg) {
    return new Promise(resolve => {
      const box = "width:100%;padding:10px;border:1px solid var(--line-strong,#B9C6DC);border-radius:8px;font:inherit;background:var(--panel-2,#F7F9FD);color:inherit;margin-bottom:10px";
      const w = document.createElement("div");
      w.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(13,24,48,.55);display:flex;align-items:center;justify-content:center;padding:16px";
      w.innerHTML =
        '<form style="background:var(--panel,#fff);color:var(--ink,#0D1830);max-width:480px;width:100%;border-radius:12px;padding:20px 22px;box-shadow:0 10px 40px rgba(0,0,0,.3);font-family:inherit">' +
        '<div style="font-weight:700;font-size:16px;margin-bottom:6px">鋳造在庫コンソールにログイン</div>' +
        '<div style="font-size:13px;line-height:1.7;color:var(--muted,#5D6E8C);margin-bottom:12px">' + (msg || "合言葉を入力してください。この端末に保存され、次回からは入力不要です。") + '</div>' +
        (needUrl ? '<input id="stk-url" type="url" placeholder="接続先 URL（https://script.google.com/macros/s/…/exec）" style="' + box + '">' : '') +
        '<input id="stk-tok" type="password" autocomplete="current-password" placeholder="合言葉" style="' + box + '">' +
        '<label style="font-size:12px;color:var(--muted,#5D6E8C);display:flex;gap:6px;align-items:center"><input id="stk-keep" type="checkbox" checked>この端末に記憶する</label>' +
        '<div id="stk-err" style="color:var(--b0,#B8352A);font-size:12px;min-height:18px;margin:6px 0"></div>' +
        '<div style="text-align:right"><button type="submit" style="background:var(--rb,#1F4AC4);color:#fff;border:0;border-radius:8px;padding:9px 18px;font:inherit;font-weight:600;cursor:pointer">ログイン</button></div></form>';
      document.body.appendChild(w);
      const f = w.querySelector("form"), err = w.querySelector("#stk-err");
      const ui = w.querySelector("#stk-url"), ti = w.querySelector("#stk-tok");
      f.onsubmit = async ev => {
        ev.preventDefault();
        const url = ui ? ui.value.trim() : apiUrl(), tok = ti.value.trim();
        if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { err.textContent = "接続先 URL を確認してください"; return; }
        if (!tok) { err.textContent = "合言葉を入力してください"; return; }
        err.textContent = "確認中…";
        try {
          const u = new URL(url); u.searchParams.set("token", tok); u.searchParams.set("t", Date.now());
          const j = await (await fetch(u, { cache: "no-store" })).json();
          if (!j.ok) { err.textContent = j.error === "unauthorized" ? "合言葉が違います" : "接続できません（" + j.error + "）"; return; }
        } catch (e) { err.textContent = "接続できません。URL とネット接続を確認してください"; return; }
        memToken = tok;
        try {
          if (ui) localStorage.setItem(LS_KEY, url);
          if (w.querySelector("#stk-keep").checked) localStorage.setItem(LS_TOK, tok); else localStorage.removeItem(LS_TOK);
        } catch (e) {}
        w.remove(); resolve();
      };
      (ui || ti).focus();
    });
  }
  let relogging = false;
  function relogin() {
    if (relogging) return;
    relogging = true;
    try { localStorage.removeItem(LS_TOK); } catch (e) {}
    memToken = "";
    ask(false, "合言葉が変更されたか、正しくありません。もう一度入力してください。").then(() => location.reload());
  }

  window.claude = window.claude || {};
  window.claude.use = async function (name) {
    if (name === "downloads") return downloads;
    if (name === "db") {
      if (!apiUrl() || !token()) await ask(!apiUrl());
      return db;
    }
    return null;
  };
  // ログアウト／接続先のやり直し：開発者ツールのコンソールで stkResetConnection() を実行
  window.stkResetConnection = () => { try { localStorage.removeItem(LS_KEY); localStorage.removeItem(LS_TOK); } catch (e) {} location.reload(); };
})();
