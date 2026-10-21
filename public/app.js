/* SAA-C03 practice app — vanilla JS SPA (hash routing, localStorage progress) */
(() => {
  'use strict';

  // ---------- Constants ----------
  const DOMAINS = {
    secure: { name: 'Design Secure Architectures', short: 'Secure', weight: 30, target: 20 },
    resilient: { name: 'Design Resilient Architectures', short: 'Resilient', weight: 26, target: 17 },
    performance: { name: 'Design High-Performing Architectures', short: 'High-Performing', weight: 24, target: 15 },
    cost: { name: 'Design Cost-Optimized Architectures', short: 'Cost-Optimized', weight: 20, target: 13 },
  };
  const DKEYS = Object.keys(DOMAINS);
  const EXAM_SIZE = 65;
  const EXAM_MINUTES = 130;
  const PASS_SCALED = 720;
  const LETTERS = 'ABCDEFGH';
  const STORE_KEY = 'saa-practice-v1';
  const DIFF = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };

  // ---------- State ----------
  const bank = { topics: [], topicMap: {}, questions: [], byId: {}, exams: [] };
  // book: per-question page state { done, ok, choice, later, note, at }. bookPos: last page opened per topic.
  // attempts, qstats, bookmarks (bookmarksAt) and book are synced to the cloud; see "Cloud sync" below.
  // session, prefs and bookPos stay on this device.
  const EMPTY_STORE = () => ({ attempts: [], qstats: {}, bookmarks: [], bookmarksAt: 0, resetAt: 0, session: null, prefs: {}, book: {}, bookPos: {}, syncPending: [], syncWipe: [] });
  let store = EMPTY_STORE();
  let timerHandle = null;
  let reviewFilter = 'all';
  const PAGE_SIZE = 20;
  let historyPage = 0;
  let listLimit = PAGE_SIZE; // "Load more" size for mistakes / bookmarks

  // ---------- Utilities ----------
  const $ = sel => document.querySelector(sel);
  const app = () => $('#app');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rand = Math.random) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }
  function fmtDate(ts) {
    return new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  // AWS uses a non-linear scaled score; this maps 72% raw -> 720 as a rough estimate
  function scaledScore(ratio) {
    const r = Math.max(0, Math.min(1, ratio));
    return Math.round(r <= 0.72 ? 100 + (r / 0.72) * 620 : 720 + ((r - 0.72) / 0.28) * 280);
  }
  function sameSet(a = [], b = []) {
    if (a.length !== b.length) return false;
    const s = new Set(a);
    return b.every(x => s.has(x));
  }
  function requiredCount(q) { return q.answer.length; }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._h);
    toast._h = setTimeout(() => t.classList.remove('show'), 1800);
  }
  function confirmModal(title, body, okLabel, danger, cancelLabel) {
    return new Promise(resolve => {
      const m = $('#modal');
      m.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
        <h3>${esc(title)}</h3><p>${body}</p>
        <div class="row"><button class="btn ghost" data-r="0">${esc(cancelLabel)}</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(okLabel)}</button></div></div>`;
      m.hidden = false;
      const done = v => { m.hidden = true; m.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(v); };
      const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
      document.addEventListener('keydown', onKey, true);
      m.onclick = e => {
        if (e.target === m) return done(false);
        const b = e.target.closest('[data-r]');
        if (b) done(b.dataset.r === '1');
      };
      m.querySelector('[data-r="1"]').focus();
    });
  }

  // ---------- Persistence ----------
  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) store = Object.assign(store, JSON.parse(raw));
    } catch (_) { /* storage unavailable: run in-memory */ }
    // Pages queued by the first book-only sync version
    if (Array.isArray(store.bookPending)) {
      store.bookPending.forEach(id => { if (!store.syncPending.includes('book:' + id)) store.syncPending.push('book:' + id); });
      delete store.bookPending;
    }
  }
  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (_) { /* ignore */ }
    updateCounts();
  }
  function recordAnswer(q, correct) {
    const s = store.qstats[q.id] || (store.qstats[q.id] = { seen: 0, correct: 0 });
    s.seen++;
    if (correct) s.correct++;
    s.last = correct;
    s.at = Date.now();
    markDirty('qstat', q.id);
  }
  const mistakeIds = () => Object.keys(store.qstats).filter(id => store.qstats[id].last === false && bank.byId[id]);

  // ---------- Cloud sync ----------
  // All study data (book pages and notes, per-question stats, exam history, bookmarks) is saved in
  // localStorage first, then sent to /api/data (DynamoDB behind CloudFront). Keys that haven't reached
  // the cloud yet wait in syncPending ("kind:id") and are retried; "Reset" wipes wait in syncWipe.
  // Each item carries an "at" timestamp and the newest copy wins, so two devices merge instead of overwrite.
  const cloud = { state: 'idle', timer: null, running: null, again: false, lastPull: 0 }; // idle | syncing | synced | local
  const bookEntry = id => store.book[id] || {};
  const BATCH = 50;

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // The Lambda origin sits behind CloudFront OAC, which requires the payload hash on requests with a body.
  async function api(method, path, body) {
    const opts = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['x-amz-content-sha256'] = await sha256Hex(opts.body);
    }
    const res = await fetch('/api' + path, opts);
    if (!res.ok || !(res.headers.get('content-type') || '').includes('application/json')) throw new Error(`api ${res.status}`);
    return res.json();
  }

  function setCloud(state) {
    cloud.state = state;
    const el = $('#syncState');
    if (el) el.outerHTML = syncBadge();
    const side = $('#syncSide');
    if (side) side.innerHTML = syncBadge('syncSideBadge');
  }
  function syncBadge(id = 'syncState') {
    const pending = store.syncPending.length + store.syncWipe.length;
    const map = {
      idle: ['muted', 'Saved'],
      syncing: ['muted', 'Saving…'],
      synced: ['good', '✓ Synced to cloud'],
      local: ['warn', `Saved on this device${pending ? ` · ${pending} waiting to sync` : ''}`],
    };
    const [cls, label] = map[cloud.state] || map.idle;
    return `<span class="sync ${cls}" id="${id}" title="${cloud.state === 'local' ? 'The cloud copy is unavailable right now; changes sync automatically when it is back.' : ''}">${label}</span>`;
  }

  // What gets sent for one key; null when the item no longer exists locally.
  function payloadFor(kind, id) {
    if (kind === 'book') return store.book[id] || null;
    if (kind === 'qstat') return store.qstats[id] ? { ...store.qstats[id], at: store.qstats[id].at || 1 } : null;
    if (kind === 'attempt') {
      const a = store.attempts.find(x => x.id === id);
      return a ? { json: JSON.stringify(a), at: a.date } : null;
    }
    if (kind === 'meta' && id === 'bookmarks') return { list: store.bookmarks, at: store.bookmarksAt || 1 };
    if (kind === 'meta' && id === 'reset') return store.resetAt ? { list: [], at: store.resetAt } : null;
    return null;
  }

  function markDirty(kind, id, delay = 300) {
    const key = `${kind}:${id}`;
    if (!store.syncPending.includes(key)) store.syncPending.push(key);
    clearTimeout(cloud.timer);
    cloud.timer = setTimeout(flush, delay);
  }

  function saveBook(id, patch, delay = 0) {
    store.book[id] = Object.assign({}, bookEntry(id), patch, { at: Date.now() });
    markDirty('book', id, delay);
    saveStore();
  }

  // Sends pending wipes, then pending items in batches. Only one flush runs at a time.
  function flush() {
    if (cloud.running) { cloud.again = true; return cloud.running; }
    cloud.running = (async () => {
      let failed = false;
      try {
        for (const kind of store.syncWipe.slice()) {
          await api('DELETE', '/data/' + kind);
          store.syncWipe = store.syncWipe.filter(k => k !== kind);
          saveStore();
        }
        if (store.syncPending.length) setCloud('syncing');
        while (store.syncPending.length) {
          const keys = store.syncPending.slice(0, BATCH);
          const sent = keys.map(key => {
            const [kind, ...rest] = key.split(':');
            const id = rest.join(':');
            return { key, kind, id, item: payloadFor(kind, id) };
          });
          const live = sent.filter(s => s.item);
          if (live.length) await api('POST', '/data/batch', { items: live.map(({ kind, id, item }) => ({ kind, id, item })) });
          // Clear a key only if it didn't change again while the request was in flight
          const done = new Set(sent.filter(s => !s.item || (payloadFor(s.kind, s.id) || {}).at === s.item.at).map(s => s.key));
          store.syncPending = store.syncPending.filter(k => !done.has(k));
          saveStore();
          if (!done.size) break;
        }
      } catch (_) { failed = true; }
      setCloud(failed ? 'local' : store.syncPending.length ? 'syncing' : 'synced');
    })().finally(() => {
      cloud.running = null;
      if (cloud.again) { cloud.again = false; flush(); }
    });
    return cloud.running;
  }

  // Newest timestamp wins per item; anything only this device has is queued for upload.
  function mergeRemote(remote) {
    const queue = key => { if (!store.syncPending.includes(key)) store.syncPending.push(key); };
    // Another device reset its progress: drop this device's history and stats from before that moment
    const reset = (remote.meta || []).find(m => m.id === 'reset');
    if (reset && reset.at > (store.resetAt || 0)) {
      store.resetAt = reset.at;
      store.attempts = store.attempts.filter(a => a.date > reset.at);
      Object.keys(store.qstats).forEach(id => { if ((store.qstats[id].at || 0) <= reset.at) delete store.qstats[id]; });
      store.syncPending = store.syncPending.filter(k => {
        const [kind, ...rest] = k.split(':');
        return !(kind === 'attempt' || kind === 'qstat') || payloadFor(kind, rest.join(':'));
      });
    }
    const lww = (kind, box) => {
      if (store.syncWipe.includes(kind)) return; // a reset from this device hasn't reached the cloud yet
      const seen = new Set();
      (remote[kind] || []).forEach(({ id, ...it }) => {
        seen.add(id);
        const mine = box[id];
        if (!mine || (it.at || 0) > (mine.at || 0)) {
          box[id] = it;
          store.syncPending = store.syncPending.filter(k => k !== `${kind}:${id}`);
        } else if ((mine.at || 0) > (it.at || 0)) queue(`${kind}:${id}`);
      });
      Object.keys(box).forEach(id => { if (!seen.has(id)) queue(`${kind}:${id}`); });
    };
    lww('book', store.book);
    lww('qstat', store.qstats);

    if (!store.syncWipe.includes('attempt')) {
      const have = new Set(store.attempts.map(a => a.id));
      const remoteIds = new Set();
      (remote.attempt || []).forEach(({ id, json }) => {
        remoteIds.add(id);
        if (have.has(id)) return;
        try { store.attempts.push(JSON.parse(json)); } catch (_) { /* skip a damaged record */ }
      });
      store.attempts.forEach(a => { if (!remoteIds.has(a.id)) queue(`attempt:${a.id}`); });
      store.attempts.sort((a, b) => b.date - a.date);
      store.attempts = store.attempts.slice(0, 300);
    }

    const bm = (remote.meta || []).find(m => m.id === 'bookmarks');
    const mineAt = store.bookmarksAt || 0;
    if (bm && bm.at > mineAt) {
      store.bookmarks = bm.list || [];
      store.bookmarksAt = bm.at;
      store.syncPending = store.syncPending.filter(k => k !== 'meta:bookmarks');
    } else if ((bm && mineAt > bm.at) || (!bm && (store.bookmarks.length || mineAt))) {
      if (!store.bookmarksAt) store.bookmarksAt = Date.now();
      queue('meta:bookmarks');
    }
  }

  async function pull() {
    cloud.lastPull = Date.now();
    try {
      if (store.syncWipe.length) await flush();
      if (store.syncWipe.length) throw new Error('reset not synced yet');
      const remote = await api('GET', '/data');
      mergeRemote(remote);
      saveStore();
      setCloud(store.syncPending.length ? 'syncing' : 'synced');
      await flush();
      return true;
    } catch (_) {
      setCloud('local');
      return false;
    }
  }
  // Don't redraw under the user's hands: not during a quiz session or while typing a note
  function rerenderIfIdle() {
    if (location.hash === '#/quiz' || /textarea|input/i.test((document.activeElement || {}).tagName)) return;
    rerender();
  }
  window.addEventListener('online', () => flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - cloud.lastPull > 30000) pull().then(ok => ok && rerenderIfIdle());
  });

  function updateCounts() {
    if (!bank.questions.length) return;
    $('#mistakeCount').textContent = mistakeIds().length || '';
    $('#bookmarkCount').textContent = store.bookmarks.filter(id => bank.byId[id]).length || '';
  }

  // ---------- Bank ----------
  async function loadBank() {
    const res = await fetch('/bank.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`bank request failed: ${res.status}`);
    const data = await res.json();
    if (data.errors && data.errors.length) console.warn('Question file errors:', data.errors);
    bank.topics = data.topics;
    bank.topicMap = Object.fromEntries(data.topics.map(t => [t.key, t]));
    bank.questions = data.questions.filter(q => q && q.id && Array.isArray(q.options) && Array.isArray(q.answer) && DOMAINS[q.domain]);
    bank.byId = Object.fromEntries(bank.questions.map(q => [q.id, q]));
    buildExams();
    $('#bankInfo').innerHTML = `${bank.questions.length} questions · ${bank.topics.length} topics<br>${bank.exams.length} full practice exams`;
    updateCounts();
  }

  // Last question id per topic in each bank release. Exams are dealt release by release, each shuffled
  // on its own, so adding questions only creates new exams and never reshuffles the ones already taken.
  // When questions are added, append a new entry with the current last ids before shipping more.
  const RELEASES = [
    {
      analytics: 45, cdn: 45, containers: 35, 'ec2-advanced': 40, ec2: 60, fundamentals: 45, 'ha-scaling': 55,
      hybrid: 45, 'iam-org': 45, 'nosql-caching': 45, rds: 55, route53: 45, s3: 70, security: 45,
      serverless: 75, storage: 45, 'vpc-advanced': 45, vpc: 45,
    },
    {
      analytics: 75, cdn: 75, containers: 70, 'ec2-advanced': 70, ec2: 90, fundamentals: 75, 'ha-scaling': 85,
      hybrid: 75, 'iam-org': 75, 'nosql-caching': 75, rds: 85, route53: 75, s3: 100, security: 75,
      serverless: 105, storage: 75, 'vpc-advanced': 75, vpc: 75,
    },
    {
      analytics: 75, cdn: 75, containers: 70, 'ec2-advanced': 72, ec2: 114, fundamentals: 102, 'ha-scaling': 85,
      hybrid: 75, 'iam-org': 133, 'nosql-caching': 75, rds: 85, route53: 85, s3: 146, security: 77,
      serverless: 105, storage: 81, 'vpc-advanced': 77, vpc: 119,
    },
  ];
  const releaseOf = q => {
    const n = Number(q.id.slice(q.id.lastIndexOf('-') + 1));
    const i = RELEASES.findIndex(r => n <= (r[q.topic] || 0));
    return i === -1 ? RELEASES.length : i;
  };
  const releaseSeed = i => (i === 0 ? 'saa-exam-' : `saa-exam-v${i + 1}-`);

  // Fixed exams: each domain pool is shuffled with a stable seed and dealt out without overlap
  function buildExams() {
    const pools = {};
    DKEYS.forEach(d => {
      pools[d] = [];
      for (let i = 0; i <= RELEASES.length; i++) {
        const ids = bank.questions.filter(q => q.domain === d && releaseOf(q) === i).map(q => q.id).sort();
        pools[d].push(...shuffle(ids, rng(hashStr(releaseSeed(i) + d))));
      }
    });
    const count = Math.min(...DKEYS.map(d => Math.floor(pools[d].length / DOMAINS[d].target)));
    bank.exams = [];
    for (let i = 0; i < count; i++) {
      const ids = DKEYS.flatMap(d => pools[d].slice(i * DOMAINS[d].target, (i + 1) * DOMAINS[d].target));
      bank.exams.push({ key: `exam-${i + 1}`, title: `Practice Exam ${i + 1}`, qids: shuffle(ids, rng(hashStr('order-' + i))) });
    }
  }

  // Random exam: domain-weighted, least-seen questions first
  function pickWeighted(pool, size) {
    const byDomain = {};
    DKEYS.forEach(d => (byDomain[d] = []));
    pool.forEach(q => byDomain[q.domain].push(q));
    const seen = id => (store.qstats[id] ? store.qstats[id].seen : 0);
    const out = [];
    DKEYS.forEach(d => {
      const n = Math.round((DOMAINS[d].weight / 100) * size);
      const list = shuffle(byDomain[d]).sort((a, b) => seen(a.id) - seen(b.id));
      out.push(...list.slice(0, n));
    });
    if (out.length < size) {
      const used = new Set(out.map(q => q.id));
      out.push(...shuffle(pool.filter(q => !used.has(q.id))).slice(0, size - out.length));
    }
    return shuffle(out.slice(0, size)).map(q => q.id);
  }

  // ---------- Sessions ----------
  function startSession(opts) {
    const qids = opts.qids.filter(id => bank.byId[id]);
    if (!qids.length) return toast('No questions match these filters');
    store.session = {
      id: uid(),
      kind: opts.kind,
      title: opts.title,
      mode: opts.mode, // 'exam' | 'practice'
      examKey: opts.examKey || null,
      topicKey: opts.topicKey || null,
      qids,
      answers: {},
      checked: {},
      flagged: {},
      current: 0,
      startedAt: Date.now(),
      timeLimit: opts.timeLimit || 0,
      elapsed: 0,
    };
    saveStore();
    location.hash = '#/quiz';
  }

  async function finishSession(auto = false) {
    const s = store.session;
    if (!s) return;
    if (!auto) {
      const unanswered = s.qids.filter((_, i) => !(s.answers[i] || []).length).length;
      const flagged = Object.values(s.flagged).filter(Boolean).length;
      const notes = [];
      if (unanswered) notes.push(`<b>${unanswered}</b> unanswered (counted as incorrect)`);
      if (flagged) notes.push(`<b>${flagged}</b> flagged for review`);
      const ok = await confirmModal(
        s.mode === 'exam' ? 'Submit exam?' : 'Finish this quiz?',
        notes.length ? `You have ${notes.join(' and ')}.` : 'All questions are answered.',
        s.mode === 'exam' ? 'Submit exam' : 'Finish quiz',
        false,
        'Keep answering'
      );
      if (!ok) return;
    }
    stopTimer();
    const byDomain = {}, byTopic = {};
    let correct = 0;
    const results = s.qids.map((id, i) => {
      const q = bank.byId[id];
      const ans = s.answers[i] || [];
      const ok = sameSet(ans, q.answer);
      if (ok) correct++;
      // practice mode already recorded checked questions
      // unanswered questions are not recorded, so they don't flood "Review Mistakes"
      if (!(s.mode === 'practice' && s.checked[i]) && ans.length) recordAnswer(q, ok);
      for (const [map, key] of [[byDomain, q.domain], [byTopic, q.topic]]) {
        map[key] = map[key] || [0, 0];
        map[key][1]++;
        if (ok) map[key][0]++;
      }
      return ok;
    });
    const ratio = correct / s.qids.length;
    const attempt = {
      id: s.id, kind: s.kind, title: s.title, mode: s.mode, examKey: s.examKey, topicKey: s.topicKey,
      date: Date.now(), qids: s.qids, answers: s.answers, flagged: s.flagged, results,
      correct, total: s.qids.length, pct: Math.round(ratio * 100), scaled: scaledScore(ratio),
      passed: scaledScore(ratio) >= PASS_SCALED, duration: s.elapsed, timeLimit: s.timeLimit, byDomain, byTopic,
    };
    store.attempts.unshift(attempt);
    store.attempts = store.attempts.slice(0, 300);
    markDirty('attempt', attempt.id);
    store.session = null;
    saveStore();
    if (auto) toast("Time's up — exam submitted");
    reviewFilter = 'all';
    location.hash = `#/result/${attempt.id}`;
  }

  function startTimer() {
    if (timerHandle) return; // keep ticking across re-renders of the same question view
    let last = Date.now();
    timerHandle = setInterval(() => {
      const s = store.session;
      if (!s) return stopTimer();
      const now = Date.now();
      s.elapsed += (now - last) / 1000;
      last = now;
      const el = $('#timer');
      if (el) {
        if (s.timeLimit) {
          const left = s.timeLimit - s.elapsed;
          el.textContent = fmtTime(left);
          el.classList.toggle('low', left < 300);
          if (left <= 0) return finishSession(true);
        } else el.textContent = fmtTime(s.elapsed);
      }
      if (Math.round(s.elapsed) % 5 === 0) saveStore();
    }, 1000);
  }
  function stopTimer() { if (timerHandle) { clearInterval(timerHandle); timerHandle = null; } }

  // ---------- Stats helpers ----------
  function topicStats(key) {
    const qs = bank.questions.filter(q => q.topic === key);
    let seen = 0, correctLast = 0;
    qs.forEach(q => { const s = store.qstats[q.id]; if (s) { seen++; if (s.last) correctLast++; } });
    return { total: qs.length, seen, correctLast, mastery: pct(correctLast, qs.length), acc: pct(correctLast, seen) };
  }
  function domainAccuracy() {
    const out = {};
    DKEYS.forEach(d => (out[d] = [0, 0]));
    Object.entries(store.qstats).forEach(([id, s]) => {
      const q = bank.byId[id];
      if (!q) return;
      out[q.domain][1] += s.seen;
      out[q.domain][0] += s.correct;
    });
    return out;
  }
  function examBest(key) {
    const list = store.attempts.filter(a => a.examKey === key);
    if (!list.length) return null;
    return { best: list.reduce((m, a) => (a.scaled > m.scaled ? a : m)), count: list.length };
  }

  // ---------- Shared render pieces ----------
  const domainChip = d => `<span class="chip ${d}">${esc(DOMAINS[d].short)}</span>`;
  const topicName = k => (bank.topicMap[k] ? bank.topicMap[k].title : k);

  function domainBars(map, emptyLabel = 'No data yet') {
    return DKEYS.map(d => {
      const [c, t] = map[d] || [0, 0];
      return `<div class="domain-row">
        <div class="label"><span class="dot ${d}"></span>${esc(DOMAINS[d].name)}</div>
        <div class="bar"><i class="${d}" style="width:${pct(c, t)}%"></i></div>
        <div class="val">${t ? `${pct(c, t)}% <span class="muted">(${c}/${t})</span>` : `<span class="muted">${emptyLabel}</span>`}</div>
      </div>`;
    }).join('');
  }

  function renderOptions(q, chosen, reveal, interactive) {
    const multi = q.type === 'multi';
    return `<div class="options">${q.options.map((opt, i) => {
      const isSel = chosen.includes(i);
      const isAns = q.answer.includes(i);
      let cls = 'option' + (multi ? ' multi' : '');
      let tag = '';
      if (reveal) {
        if (isAns && isSel) { cls += ' correct'; tag = '✓ Correct'; }
        else if (isAns) { cls += ' correct missed'; tag = 'Correct answer'; }
        else if (isSel) { cls += ' wrong'; tag = '✗ Your answer'; }
      } else if (isSel) cls += ' selected';
      // a div, not a button, so the option text can be selected and copied
      return `<div class="${cls}" data-opt="${i}" role="button" ${interactive ? 'tabindex="0"' : 'aria-disabled="true"'}>
        <span class="key">${LETTERS[i]}</span><span class="txt">${esc(opt)}</span>${tag ? `<span class="tag">${tag}</span>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  function explanationBlock(q, chosen) {
    const ok = sameSet(chosen, q.answer);
    const answered = chosen.length > 0;
    const head = !answered ? 'Not answered' : ok ? 'Correct' : 'Incorrect';
    return `<div class="explain ${answered ? (ok ? 'good' : 'bad') : ''}">
      <h4>${head} — answer: ${q.answer.map(a => LETTERS[a]).join(', ')}</h4>
      <p>${esc(q.explanation)}</p>
      ${q.source ? `<a class="source" href="${esc(q.source)}" target="_blank" rel="noopener noreferrer">Source: AWS documentation ↗</a>` : ''}
    </div>`;
  }

  function setActiveNav(name) {
    document.querySelectorAll('.sidebar a').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
    $('#sidebar').classList.remove('open');
  }

  // Only the dashboard makes Resume its primary action; other pages keep their own primary
  function resumeBanner(primary = false) {
    const s = store.session;
    if (!s) return '';
    const answered = Object.values(s.answers).filter(a => a && a.length).length;
    return `<div class="resume"><div><b>Session in progress:</b> ${esc(s.title)} · ${answered}/${s.qids.length} answered</div>
      <span class="spacer"></span>
      <button class="btn sm danger" data-action="discard-session">Discard</button>
      <a class="btn sm ${primary ? 'primary' : ''}" href="#/quiz">Resume →</a></div>`;
  }

  function pager(page, total, size, action) {
    const pages = Math.ceil(total / size);
    if (pages <= 1) return '';
    return `<div class="pager"><span class="muted small">Showing ${page * size + 1}–${Math.min(total, (page + 1) * size)} of ${total}</span>
      <span class="spacer"></span>
      <button class="btn sm" data-action="${action}" data-page="${page - 1}" ${page === 0 ? 'disabled' : ''}>← Newer</button>
      <span class="small text-2">Page ${page + 1} of ${pages}</span>
      <button class="btn sm" data-action="${action}" data-page="${page + 1}" ${page >= pages - 1 ? 'disabled' : ''}>Older →</button></div>`;
  }

  // ---------- Views ----------
  function viewHome() {
    setActiveNav('home');
    const attempts = store.attempts;
    const exams = attempts.filter(a => a.kind === 'exam');
    const seenCount = Object.keys(store.qstats).filter(id => bank.byId[id]).length;
    let totalSeen = 0, totalCorrect = 0;
    Object.entries(store.qstats).forEach(([id, s]) => { if (bank.byId[id]) { totalSeen += s.seen; totalCorrect += s.correct; } });
    const best = exams.length ? Math.max(...exams.map(a => a.scaled)) : null;
    const nextExam = bank.exams.find(e => !examBest(e.key)) || bank.exams[0];
    const weak = bank.topics.map(t => ({ t, s: topicStats(t.key) })).filter(x => x.s.seen >= 5).sort((a, b) => a.s.acc - b.s.acc).slice(0, 5);
    const mistakes = mistakeIds().length;

    app().innerHTML = `
      ${resumeBanner(true)}
      <section class="hero">
        <div class="eyebrow">AWS Certified Solutions Architect – Associate · SAA-C03</div>
        <h1>Practice like the real exam.</h1>
        <p>Scenario-based questions written in the SAA-C03 style, full-length timed exams weighted by domain, and focused quizzes for every course section.</p>
        <div class="facts">
          <div class="fact"><b>65</b><span>questions (50 scored + 15 unscored)</span></div>
          <div class="fact"><b>130</b><span>minutes</span></div>
          <div class="fact"><b>720</b><span>pass score (scale 100–1000)</span></div>
          <div class="fact"><b>2</b><span>types: multiple choice / response</span></div>
          <div class="fact"><b>$150</b><span>exam fee (USD)</span></div>
        </div>
        <div class="hero-actions">
          ${nextExam ? `<button class="btn ${store.session ? '' : 'primary'} lg" data-action="start-exam" data-key="${nextExam.key}">Start ${esc(nextExam.title)}</button>` : ''}
          <button class="btn lg" data-action="random-exam">Random full exam</button>
          <button class="btn lg" data-action="quick-quiz">Quick 10 (instant feedback)</button>
        </div>
      </section>

      <div class="section grid grid-4">
        <div class="card stat"><b>${bank.questions.length}</b><span>Questions in bank</span><div class="sub">${pct(seenCount, bank.questions.length)}% attempted (${seenCount})</div></div>
        <div class="card stat"><b>${totalSeen ? pct(totalCorrect, totalSeen) + '%' : '—'}</b><span>Overall accuracy</span><div class="sub">${totalSeen} answers recorded</div></div>
        <div class="card stat"><b>${exams.length ? `${exams.filter(a => a.passed).length}/${exams.length}` : '—'}</b><span>Exams passed</span><div class="sub">${bank.exams.length} practice exams available</div></div>
        <div class="card stat"><b>${best ?? '—'}</b><span>Best scaled score</span><div class="sub">${best != null ? (best >= PASS_SCALED ? 'Above the 720 pass mark' : `${PASS_SCALED - best} below pass mark`) : 'Take an exam to see it'}</div></div>
      </div>

      <div class="section grid grid-2">
        <div class="card pad-lg">
          <div class="section-head"><h2>Accuracy by domain</h2><a href="#/guide" class="small">Exam weights →</a></div>
          ${domainBars(domainAccuracy())}
        </div>
        <div class="card pad-lg">
          <div class="section-head"><h2>Focus areas</h2>${mistakes ? `<a href="#/review" class="small">${mistakes} to review →</a>` : ''}</div>
          ${weak.length ? `<table class="sub-table"><tbody>${weak.map(({ t, s }) => `
            <tr class="pick" data-href="#/book/${t.key}"><td>${esc(t.icon)} ${esc(t.title)}</td><td class="num">${s.acc}%</td><td class="num muted">${s.seen}/${s.total}</td></tr>`).join('')}
            </tbody></table>` : `<p class="muted">Answer at least 5 questions in a topic and your weakest topics will show up here.</p>`}
        </div>
      </div>

      <div class="section">
        <div class="section-head"><h2>Recent activity</h2><a href="#/history" class="small">All history →</a></div>
        ${attempts.length ? historyTable(attempts.slice(0, 5)) : `<div class="empty">No attempts yet — start with a practice exam or a topic quiz.</div>`}
      </div>`;
  }

  function viewExams() {
    setActiveNav('exams');
    const upNext = (bank.exams.find(e => !examBest(e.key)) || {}).key;
    app().innerHTML = `
      ${resumeBanner()}
      <div class="page-head"><div><h1>Practice Exams</h1>
        <p>Each exam has ${EXAM_SIZE} questions weighted like SAA-C03 (Secure 20 · Resilient 17 · High-Performing 15 · Cost 13), ${EXAM_MINUTES} minutes, no feedback until you submit.</p></div>
        <div class="row"><button class="btn" data-action="random-exam">Random full exam</button><button class="btn" data-action="half-exam">Half exam (33 Q · 65 min)</button></div>
      </div>
      <div class="grid grid-auto">
        ${bank.exams.map((e, i) => {
          const b = examBest(e.key);
          const diff = e.qids.reduce((s, id) => s + (bank.byId[id].difficulty || 2), 0) / e.qids.length;
          const next = e.key === upNext;
          return `<div class="card clickable exam-card ${next ? 'up-next' : ''}" data-action="start-exam" data-key="${e.key}">
            <div class="row" style="justify-content:space-between"><div class="num">Exam ${String(i + 1).padStart(2, '0')}</div>${next ? '<span class="chip accent">Up next</span>' : ''}</div>
            <h3>${esc(e.title)}</h3>
            <div class="meta"><span class="chip">${e.qids.length} Q</span><span class="chip">${EXAM_MINUTES} min</span><span class="chip">avg difficulty ${diff.toFixed(1)}</span></div>
            <div class="foot">
              ${b ? `<span>Best: <span class="score-pill ${b.best.passed ? 'pass' : 'fail'}">${b.best.scaled}</span> <span class="muted small">(${b.best.pct}% · ${b.count} attempt${b.count > 1 ? 's' : ''})</span></span>`
                : `<span class="muted small">Not attempted</span>`}
              <span class="btn sm ${next ? 'primary' : ''}">${b ? 'Retake' : 'Start'}</span>
            </div>
          </div>`;
        }).join('')}
      </div>
      ${!bank.exams.length ? '<div class="empty">Not enough questions to build a full exam yet.</div>' : ''}`;
  }

  // ---------- Books (one per topic, one question per page) ----------
  const bookPages = key => bank.questions.filter(q => q.topic === key); // file order = page order
  function bookStats(key) {
    const pages = bookPages(key);
    const s = { total: pages.length, done: 0, ok: 0, later: 0, notes: 0, firstOpen: -1 };
    pages.forEach((q, i) => {
      const e = bookEntry(q.id);
      if (e.done) { s.done++; if (e.ok) s.ok++; } else if (s.firstOpen < 0) s.firstOpen = i;
      if (e.later) s.later++;
      if (e.note && e.note.trim()) s.notes++;
    });
    return s;
  }
  // Resume where the reader left off, else the first page that isn't solved yet
  function resumePage(key) {
    const s = bookStats(key);
    const last = store.bookPos[key];
    if (last != null && last < s.total) return last;
    return s.firstOpen >= 0 ? s.firstOpen : 0;
  }

  function viewTopics() {
    setActiveNav('topics');
    const groups = [...new Set(bank.topics.map(t => t.group))];
    app().innerHTML = `
      ${resumeBanner()}
      <div class="page-head"><div><h1>Topic Books</h1>
        <p>Each topic is a book and each question is a page. Solve a page to complete it, write your own notes, and mark pages to come back to.</p></div>
        <div class="row"><a class="btn" href="#/notes">My notes</a><a class="btn" href="#/custom">Build custom quiz</a></div>
      </div>
      ${groups.map(g => `
        <div class="section"><h2>${esc(g)}</h2>
        <div class="grid grid-auto">${bank.topics.filter(t => t.group === g).map(t => {
          const s = bookStats(t.key);
          const finished = s.total && s.done === s.total;
          const started = s.done || store.bookPos[t.key] != null;
          return `<a class="card clickable book-card" href="#/book/${t.key}">
            <div class="top"><div class="topic-icon">${esc(t.icon)}</div>
              <div><h3>${esc(t.title)}</h3><p>${esc(t.summary)}</p></div></div>
            <div class="book-progress"><b>${s.done}</b><span>/ ${s.total} pages</span>${s.done ? `<span class="muted small">· ${pct(s.ok, s.done)}% correct</span>` : ''}</div>
            <div class="bar thin"><i style="width:${pct(s.done, s.total)}%"></i></div>
            <div class="stats">
              <span>${s.later ? `<span class="tag-later">⚑ ${s.later} to revisit</span>` : ''}${s.notes ? `<span>✎ ${s.notes} note${s.notes > 1 ? 's' : ''}</span>` : ''}</span>
              <span class="btn sm ${started && !finished ? 'primary' : ''}">${finished ? 'Read again' : started ? `Continue · p.${resumePage(t.key) + 1}` : 'Start reading'}</span>
            </div>
          </a>`;
        }).join('')}</div></div>`).join('')}`;
  }

  let bookDraft = { id: null, choice: [] }; // selections on an unsolved page before "Check answer"
  let bookFilter = 'all';
  const BOOK_FILTERS = [['all', 'All'], ['open', 'Unsolved'], ['wrong', 'Wrong'], ['later', 'Solve later'], ['notes', 'Has notes']];
  function pageMatches(q, f) {
    const e = bookEntry(q.id);
    if (f === 'open') return !e.done;
    if (f === 'wrong') return e.done && !e.ok;
    if (f === 'later') return !!e.later;
    if (f === 'notes') return !!(e.note && e.note.trim());
    return true;
  }

  function viewBook(key, pageArg) {
    setActiveNav('topics');
    const t = bank.topicMap[key];
    if (!t) return viewNotFound();
    const pages = bookPages(key);
    if (!pages.length) return viewNotFound();
    const n = Number(pageArg);
    if (!Number.isInteger(n) || n < 1 || n > pages.length) {
      location.replace(`#/book/${key}/${resumePage(key) + 1}`);
      return;
    }
    const i = n - 1;
    store.bookPos[key] = i;
    saveStore();
    const q = pages[i];
    const e = bookEntry(q.id);
    if (bookDraft.id !== q.id) bookDraft = { id: q.id, choice: [] };
    const chosen = e.done ? e.choice || [] : bookDraft.choice;
    const need = requiredCount(q);
    const s = bookStats(key);
    const bookmarked = store.bookmarks.includes(q.id);
    const shown = pages.map((p, k) => [p, k]).filter(([p]) => pageMatches(p, bookFilter));

    app().innerHTML = `
      <div class="book-head">
        <div><a href="#/topics" class="small">← All books</a>
          <h1>${esc(t.icon)} ${esc(t.title)}</h1></div>
        <span class="spacer"></span>
        <div class="book-count"><b>${s.done}</b> / ${s.total} pages completed${s.done ? ` · ${pct(s.ok, s.done)}% correct` : ''}</div>
      </div>
      <div class="progress-line"><i style="width:${pct(s.done, s.total)}%"></i></div>
      <div class="quiz">
        <div>
          <article class="qcard page">
            <div class="qmeta">
              <span class="qnum">Page ${n} of ${pages.length}</span>
              ${e.done ? `<span class="chip ${e.ok ? 'good' : 'bad'}">${e.ok ? '✓ Completed · correct' : '✗ Completed · incorrect'}</span>` : ''}
              ${e.done ? domainChip(q.domain) : ''}
              ${e.done && q.subtopic ? `<span class="chip">${esc(q.subtopic)}</span>` : ''}
              <span class="spacer"></span>
              <button class="btn sm ${e.later ? 'later-on' : 'ghost'}" data-action="toggle-later" title="Mark to solve later (M)">${e.later ? '⚑ Solve later' : '⚐ Solve later'}</button>
              <button class="icon-btn ${bookmarked ? 'on' : ''}" data-action="book-star" title="Bookmark (S)" aria-label="Bookmark">★</button>
            </div>
            <div class="qtext">${esc(q.question)}</div>
            ${q.type === 'multi' ? `<div class="qhint">Multiple response — choose ${need}.${e.done ? '' : ` Selected ${chosen.length}/${need}.`}</div>` : ''}
            ${renderOptions(q, chosen, !!e.done, !e.done)}
            ${e.done ? explanationBlock(q, chosen) : ''}
            <div class="qactions">
              <button class="btn" data-action="page-prev" ${i === 0 ? 'disabled' : ''}>← Previous page</button>
              <span class="spacer"></span>
              ${e.done
                ? `<button class="btn ghost" data-action="solve-again">Solve again</button>
                   ${i < pages.length - 1 ? `<button class="btn primary" data-action="page-next">Next page →</button>` : `<a class="btn primary" href="#/topics">Back to books</a>`}`
                : `${chosen.length < need ? `<span class="small text-2">${chosen.length ? `Select ${need - chosen.length} more to check` : need > 1 ? `Select ${need} answers` : 'Select an answer'}</span>` : ''}
                   ${i < pages.length - 1 ? `<button class="btn" data-action="page-next">Skip →</button>` : ''}
                   <button class="btn primary" data-action="page-check" ${chosen.length === need ? '' : 'disabled'}>Check answer</button>`}
            </div>
          </article>

          <section class="card notes-card">
            <div class="row" style="justify-content:space-between">
              <label for="pageNote"><b>My notes</b> <span class="muted small">— how you understand this question, in your own words</span></label>
              ${syncBadge()}
            </div>
            <textarea id="pageNote" data-qid="${q.id}" rows="4" placeholder="e.g. Regional NAT gateway has its own route table to the IGW, so the VPC needs no public subnet">${esc(e.note || '')}</textarea>
          </section>
          <div class="kbd-hint"><kbd>1</kbd>–<kbd>6</kbd> or <kbd>A</kbd>–<kbd>F</kbd> select · <kbd>Enter</kbd> check / next page · <kbd>←</kbd> <kbd>→</kbd> turn pages · <kbd>M</kbd> solve later · <kbd>S</kbd> star · <kbd>N</kbd> write a note</div>
        </div>

        <aside class="navigator"><div class="card">
          <div class="row" style="justify-content:space-between"><b>Contents</b><span class="muted small">${s.done}/${s.total} done</span></div>
          <div class="toc-filters">${BOOK_FILTERS.map(([k, l]) => {
            const c = pages.filter(p => pageMatches(p, k)).length;
            return `<button class="select-chip sm ${bookFilter === k ? 'on' : ''}" data-action="book-filter" data-key="${k}">${l} (${c})</button>`;
          }).join('')}</div>
          ${shown.length ? `<div class="nav-grid">${shown.map(([p, k]) => {
            const pe = bookEntry(p.id);
            let cls = 'nav-cell';
            if (pe.done) cls += pe.ok ? ' correct' : ' wrong';
            if (pe.later) cls += ' flagged';
            if (pe.note && pe.note.trim()) cls += ' noted';
            if (k === i) cls += ' current';
            return `<a class="${cls}" href="#/book/${key}/${k + 1}" title="Page ${k + 1}">${k + 1}</a>`;
          }).join('')}</div>` : `<p class="muted small" style="margin-top:12px">No pages match this filter.</p>`}
          <div class="legend">
            <span><i style="background:var(--good-soft);border-color:var(--good)"></i>Correct</span>
            <span><i style="background:var(--bad-soft);border-color:var(--bad)"></i>Wrong</span>
            <span><i style="background:var(--warn);border-color:var(--warn);border-radius:50%"></i>Solve later</span>
            <span><i class="note-dot"></i>Has notes</span>
          </div>
          ${s.firstOpen >= 0 ? `<button class="btn sm" style="margin-top:12px;width:100%" data-action="next-open">Next unsolved page</button>` : ''}
          ${s.later ? `<button class="btn sm" style="margin-top:8px;width:100%" data-action="next-later">Next "solve later" page</button>` : ''}
        </div></aside>
      </div>`;
  }

  function bookCtx() {
    const m = location.hash.match(/^#\/book\/([^/]+)\/(\d+)$/);
    if (!m) return null;
    const pages = bookPages(m[1]);
    const i = Number(m[2]) - 1;
    return pages[i] ? { key: m[1], pages, i, q: pages[i] } : null;
  }
  const gotoPage = (key, i) => { location.hash = `#/book/${key}/${i + 1}`; };

  function bookSelect(idx) {
    const c = bookCtx();
    if (!c || bookEntry(c.q.id).done || idx >= c.q.options.length) return;
    let chosen = bookDraft.choice.slice();
    if (c.q.type === 'single') chosen = [idx];
    else if (chosen.includes(idx)) chosen = chosen.filter(x => x !== idx);
    else {
      if (chosen.length >= requiredCount(c.q)) { toast(`Select only ${requiredCount(c.q)} — deselect one first`); return; }
      chosen.push(idx);
    }
    bookDraft = { id: c.q.id, choice: chosen.sort((a, b) => a - b) };
    rerender();
  }

  function bookCheck() {
    const c = bookCtx();
    if (!c) return;
    const chosen = bookDraft.choice;
    if (chosen.length !== requiredCount(c.q)) return toast(`Select ${requiredCount(c.q)} option${requiredCount(c.q) > 1 ? 's' : ''} first`);
    const ok = sameSet(chosen, c.q.answer);
    recordAnswer(c.q, ok);
    saveBook(c.q.id, { done: true, ok, choice: chosen });
    rerender();
  }

  function bookJump(pred) {
    const c = bookCtx();
    if (!c) return;
    for (let step = 1; step <= c.pages.length; step++) {
      const k = (c.i + step) % c.pages.length;
      if (pred(c.pages[k])) return gotoPage(c.key, k);
    }
    toast('None left');
  }

  function viewNotes() {
    setActiveNav('notes');
    const items = bank.questions.filter(q => (bookEntry(q.id).note || '').trim());
    const byTopic = {};
    items.forEach(q => (byTopic[q.topic] = byTopic[q.topic] || []).push(q));
    const index = q => bookPages(q.topic).indexOf(q);
    app().innerHTML = `
      <div class="page-head"><div><h1>My Notes</h1>
        <p>Everything you wrote on book pages, grouped by book. Open a note to see its page.</p></div>
        <span class="muted small">${items.length} note${items.length === 1 ? '' : 's'}</span></div>
      ${items.length ? bank.topics.filter(t => byTopic[t.key]).map(t => `
        <div class="section"><h2>${esc(t.icon)} ${esc(t.title)} <span class="muted small">· ${byTopic[t.key].length}</span></h2>
          ${byTopic[t.key].map(q => {
            const e = bookEntry(q.id);
            return `<a class="card clickable note-item" href="#/book/${t.key}/${index(q) + 1}">
              <div class="muted small">Page ${index(q) + 1}${q.subtopic && e.done ? ` · ${esc(q.subtopic)}` : ''}${e.done ? (e.ok ? ' · ✓ correct' : ' · ✗ incorrect') : ' · not solved yet'}${e.later ? ' · ⚑ solve later' : ''}</div>
              <div class="note-text">${esc(e.note)}</div>
              <div class="stem muted small">${esc(q.question)}</div>
            </a>`;
          }).join('')}
        </div>`).join('') : `<div class="empty">No notes yet. Open any book and write in "My notes" under a page.</div>`}`;
  }

  function filterChips(name, options, current) {
    return options.map(([val, label]) => `<button class="select-chip ${String(current) === String(val) ? 'on' : ''}" data-pref="${name}" data-val="${val}">${label}</button>`).join('');
  }

  function quizPrefs() {
    const p = store.prefs;
    return {
      count: p.count ?? 20,
      mode: p.mode ?? 'practice',
      filter: p.filter ?? 'all',
      difficulty: p.difficulty ?? 'any',
    };
  }

  function applyFilters(pool, prefs) {
    let qs = pool;
    if (prefs.difficulty !== 'any') qs = qs.filter(q => String(q.difficulty) === String(prefs.difficulty));
    if (prefs.filter === 'unseen') qs = qs.filter(q => !store.qstats[q.id]);
    if (prefs.filter === 'wrong') qs = qs.filter(q => store.qstats[q.id] && store.qstats[q.id].last === false);
    if (prefs.filter === 'multi') qs = qs.filter(q => q.type === 'multi');
    return qs;
  }

  function setupOptions(available) {
    const p = quizPrefs();
    return `
      <div class="opt-group"><div class="lbl">Mode</div><div class="row">
        ${filterChips('mode', [['practice', 'Practice — instant feedback'], ['exam', 'Exam — results at the end']], p.mode)}</div></div>
      <div class="opt-group"><div class="lbl">Number of questions</div><div class="row">
        ${filterChips('count', [[10, '10'], [20, '20'], [30, '30'], [65, '65'], ['all', 'All']], p.count)}</div></div>
      <div class="opt-group"><div class="lbl">Questions</div><div class="row">
        ${filterChips('filter', [['all', 'All'], ['unseen', 'Not seen yet'], ['wrong', 'Previously wrong'], ['multi', 'Multiple response only']], p.filter)}</div></div>
      <div class="opt-group"><div class="lbl">Difficulty</div><div class="row">
        ${filterChips('difficulty', [['any', 'Any'], [1, 'Easy'], [2, 'Medium'], [3, 'Hard']], p.difficulty)}</div></div>
      <div class="row" style="margin-top:6px"><button class="btn primary lg" data-action="start-setup" ${available ? '' : 'disabled'}>Start quiz</button>
        ${available ? `<span class="muted small">${available} question${available === 1 ? '' : 's'} match</span>`
          : `<span class="small text-2">No questions match these filters — try "All" questions and "Any" difficulty.</span>
             <button class="btn sm" data-action="reset-filters">Reset filters</button>`}</div>`;
  }

  let customTopics = new Set();
  let customDomain = 'all';
  function viewCustom() {
    setActiveNav('topics');
    const pool = bank.questions.filter(q => (!customTopics.size || customTopics.has(q.topic)) && (customDomain === 'all' || q.domain === customDomain));
    const available = applyFilters(pool, quizPrefs()).length;
    app().innerHTML = `
      ${resumeBanner()}
      <div class="page-head"><div><a href="#/topics" class="small">← All topics</a>
        <h1 style="margin-top:8px">Custom quiz</h1><p>Pick any combination of topics and a domain. No topic selected = every topic.</p></div></div>
      <div class="card pad-lg" id="setupCard" data-scope="custom">
        <div class="opt-group"><div class="lbl">Topics</div><div class="row">
          ${bank.topics.map(t => `<button class="select-chip ${customTopics.has(t.key) ? 'on' : ''}" data-action="toggle-topic" data-key="${t.key}">${esc(t.icon)} ${esc(t.title)}</button>`).join('')}
        </div></div>
        <div class="opt-group"><div class="lbl">Domain</div><div class="row">
          <button class="select-chip ${customDomain === 'all' ? 'on' : ''}" data-action="pick-domain" data-key="all">All domains</button>
          ${DKEYS.map(d => `<button class="select-chip ${customDomain === d ? 'on' : ''}" data-action="pick-domain" data-key="${d}">${esc(DOMAINS[d].name)}</button>`).join('')}
        </div></div>
        ${setupOptions(available)}
      </div>`;
  }

  function startFromSetup() {
    const p = quizPrefs();
    const topicKey = customTopics.size === 1 ? [...customTopics][0] : null;
    let pool = bank.questions.filter(q => (!customTopics.size || customTopics.has(q.topic)) && (customDomain === 'all' || q.domain === customDomain));
    let title = topicKey ? topicName(topicKey) : customTopics.size ? `Custom quiz (${customTopics.size} topics)` : 'Custom quiz (all topics)';
    if (customDomain !== 'all') title += ` · ${DOMAINS[customDomain].short}`;
    pool = applyFilters(pool, p);
    // least-seen first, then random
    const seen = id => (store.qstats[id] ? store.qstats[id].seen : 0);
    const ordered = shuffle(pool).sort((a, b) => seen(a.id) - seen(b.id));
    const n = p.count === 'all' ? ordered.length : Math.min(Number(p.count), ordered.length);
    const qids = shuffle(ordered.slice(0, n)).map(q => q.id);
    startSession({
      kind: 'topic', title, mode: p.mode, topicKey, qids,
      timeLimit: p.mode === 'exam' ? Math.ceil((qids.length * EXAM_MINUTES * 60) / EXAM_SIZE) : 0,
    });
  }

  function viewQuiz() {
    setActiveNav('');
    const s = store.session;
    if (!s) { location.hash = '#/'; return; }
    s.current = Math.max(0, Math.min(s.current, s.qids.length - 1));
    const i = s.current;
    const q = bank.byId[s.qids[i]];
    const chosen = s.answers[i] || [];
    const isPractice = s.mode === 'practice';
    const revealed = isPractice && s.checked[i];
    const answeredCount = s.qids.filter((_, k) => (s.answers[k] || []).length).length;
    const need = requiredCount(q);
    const bookmarked = store.bookmarks.includes(q.id);
    const correctSoFar = isPractice ? s.qids.filter((id, k) => s.checked[k] && sameSet(s.answers[k], bank.byId[id].answer)).length : 0;
    const checkedCount = Object.keys(s.checked).length;
    const isLast = i === s.qids.length - 1;

    app().innerHTML = `
      <div class="quiz-head">
        <div><div class="muted small">${s.mode === 'exam' ? 'Exam mode' : 'Practice mode'}</div><h2>${esc(s.title)}</h2></div>
        <span class="spacer"></span>
        ${isPractice && checkedCount ? `<span class="chip good">${correctSoFar}/${checkedCount} correct</span>` : ''}
        <span class="timer ${s.timeLimit && s.timeLimit - s.elapsed < 300 ? 'low' : ''}" id="timer" title="${s.timeLimit ? 'Time remaining' : 'Elapsed'}">${fmtTime(s.timeLimit ? s.timeLimit - s.elapsed : s.elapsed)}</span>
        <button class="btn" data-action="finish">${s.mode === 'exam' ? 'Submit exam' : 'Finish'}</button>
      </div>
      <div class="progress-line"><i style="width:${pct(answeredCount, s.qids.length)}%"></i></div>
      <div class="quiz">
        <div>
          <div class="qcard">
            <div class="qmeta">
              <span class="qnum">Question ${i + 1} of ${s.qids.length}</span>
              ${revealed || s.mode !== 'exam' ? domainChip(q.domain) : ''}
              ${revealed ? `<span class="chip">${esc(topicName(q.topic))}</span>` : ''}
              ${revealed && q.subtopic ? `<span class="chip">${esc(q.subtopic)}</span>` : ''}
              <span class="spacer"></span>
              <button class="icon-btn ${bookmarked ? 'on' : ''}" data-action="bookmark" title="Bookmark (S)">★</button>
              <button class="icon-btn ${s.flagged[i] ? 'on' : ''}" data-action="flag" title="Mark for review (M)">⚑</button>
            </div>
            <div class="qtext">${esc(q.question)}</div>
            ${q.type === 'multi' ? `<div class="qhint">Multiple response — choose ${need}. Selected ${chosen.length}/${need}.</div>` : ''}
            ${renderOptions(q, chosen, revealed, !revealed)}
            ${revealed ? explanationBlock(q, chosen) : ''}
            <div class="qactions">
              <button class="btn" data-action="prev" ${i === 0 ? 'disabled' : ''}>← Previous</button>
              <span class="spacer"></span>
              ${isPractice && !revealed && chosen.length < need ? `<span class="small text-2">${chosen.length ? `Select ${need - chosen.length} more to check` : need > 1 ? `Select ${need} answers to check` : 'Select an answer to check'}</span>` : ''}
              ${isPractice && !revealed ? `<button class="btn primary" data-action="check" ${chosen.length === need ? '' : 'disabled'}>Check answer</button>` : ''}
              ${!isPractice || revealed ? (isLast ? `<button class="btn primary" data-action="finish">${s.mode === 'exam' ? 'Review & submit' : 'Finish & see results'}</button>`
                : `<button class="btn ${revealed || chosen.length ? 'primary' : ''}" data-action="next">Next →</button>`) : ''}
            </div>
          </div>
          <div class="kbd-hint"><kbd>1</kbd>–<kbd>6</kbd> or <kbd>A</kbd>–<kbd>F</kbd> select · <kbd>Enter</kbd> ${isPractice ? 'check / next' : 'next'} · <kbd>←</kbd> <kbd>→</kbd> navigate · <kbd>M</kbd> mark/flag · <kbd>S</kbd> star</div>
        </div>
        <aside class="navigator"><div class="card">
          <div class="row" style="justify-content:space-between"><b>Questions</b><span class="muted small">${answeredCount}/${s.qids.length} answered</span></div>
          <div class="nav-grid">${s.qids.map((id, k) => {
            const a = s.answers[k] || [];
            let cls = 'nav-cell';
            if (isPractice && s.checked[k]) cls += sameSet(a, bank.byId[id].answer) ? ' correct' : ' wrong';
            else if (a.length) cls += ' answered';
            if (s.flagged[k]) cls += ' flagged';
            if (k === i) cls += ' current';
            return `<button class="${cls}" data-goto="${k}">${k + 1}</button>`;
          }).join('')}</div>
          <div class="legend">
            <span><i style="background:var(--surface-3)"></i>Answered</span>
            ${isPractice ? '<span><i style="background:var(--good-soft);border-color:var(--good)"></i>Correct</span><span><i style="background:var(--bad-soft);border-color:var(--bad)"></i>Wrong</span>' : ''}
            <span><i style="background:var(--warn);border-color:var(--warn);border-radius:50%"></i>Flagged</span>
          </div>
          ${Object.values(s.flagged).some(Boolean) ? `<button class="btn sm" style="margin-top:12px;width:100%" data-action="next-flagged">Next flagged ⚑</button>` : ''}
          ${s.qids.length - answeredCount ? `<button class="btn sm" style="margin-top:8px;width:100%" data-action="next-unanswered">Next unanswered</button>` : ''}
        </div></aside>
      </div>`;
    startTimer();
  }

  function selectOption(idx) {
    const s = store.session;
    if (!s) return;
    const i = s.current;
    const q = bank.byId[s.qids[i]];
    if (idx >= q.options.length) return;
    if (s.mode === 'practice' && s.checked[i]) return;
    let chosen = (s.answers[i] || []).slice();
    if (q.type === 'single') chosen = [idx];
    else if (chosen.includes(idx)) chosen = chosen.filter(x => x !== idx);
    else {
      if (chosen.length >= requiredCount(q)) { toast(`Select only ${requiredCount(q)} — deselect one first`); return; }
      chosen.push(idx);
    }
    s.answers[i] = chosen.sort((a, b) => a - b);
    saveStore();
    viewQuiz();
  }

  function checkCurrent() {
    const s = store.session;
    const i = s.current;
    const q = bank.byId[s.qids[i]];
    const chosen = s.answers[i] || [];
    if (!chosen.length) return toast('Choose an answer first');
    if (q.type === 'multi' && chosen.length !== requiredCount(q)) return toast(`Select ${requiredCount(q)} options`);
    s.checked[i] = true;
    recordAnswer(q, sameSet(chosen, q.answer));
    saveStore();
    viewQuiz();
  }

  function go(delta) {
    const s = store.session;
    const n = s.current + delta;
    if (n < 0 || n >= s.qids.length) return;
    s.current = n;
    saveStore();
    viewQuiz();
    window.scrollTo({ top: 0 });
  }

  function jumpTo(pred) {
    const s = store.session;
    const n = s.qids.length;
    for (let step = 1; step <= n; step++) {
      const k = (s.current + step) % n;
      if (pred(k)) { s.current = k; saveStore(); viewQuiz(); return; }
    }
    toast('None left');
  }

  function viewResult(id) {
    setActiveNav('history');
    const a = store.attempts.find(x => x.id === id);
    if (!a) return viewNotFound();
    const R = 84, C = 2 * Math.PI * R;
    const color = a.kind === 'exam' || a.total >= 30 ? (a.passed ? 'var(--good)' : 'var(--bad)') : 'var(--accent)';
    const items = a.qids.map((qid, i) => ({ q: bank.byId[qid], i, ans: a.answers[i] || [], ok: a.results[i], flag: a.flagged[i] })).filter(x => x.q);
    const counts = {
      all: items.length,
      wrong: items.filter(x => !x.ok && x.ans.length).length,
      skipped: items.filter(x => !x.ans.length).length,
      correct: items.filter(x => x.ok).length,
      flagged: items.filter(x => x.flag).length,
    };
    const shown = items.filter(x => reviewFilter === 'all' ? true : reviewFilter === 'wrong' ? !x.ok && x.ans.length : reviewFilter === 'skipped' ? !x.ans.length : reviewFilter === 'correct' ? x.ok : x.flag);
    const incorrectIds = items.filter(x => !x.ok).map(x => x.q.id);
    const topicRows = Object.entries(a.byTopic).sort((x, y) => pct(x[1][0], x[1][1]) - pct(y[1][0], y[1][1]));

    app().innerHTML = `
      <div class="page-head"><div><a href="#/history" class="small">← History</a><h1 style="margin-top:8px">${esc(a.title)}</h1>
        <p>${fmtDate(a.date)} · ${a.mode === 'exam' ? 'Exam mode' : 'Practice mode'}</p></div>
        <div class="row">
          ${incorrectIds.length ? `<button class="btn" data-action="retry-wrong" data-id="${a.id}">Retry ${incorrectIds.length} incorrect</button>` : ''}
          <button class="btn primary" data-action="retake" data-id="${a.id}">Retake</button>
        </div>
      </div>
      <div class="card pad-lg">
        <div class="result-hero">
          <div class="ring">
            <svg width="200" height="200" viewBox="0 0 200 200">
              <circle cx="100" cy="100" r="${R}" fill="none" stroke="var(--surface-3)" stroke-width="14"/>
              <circle cx="100" cy="100" r="${R}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"
                stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - a.pct / 100)}"/>
            </svg>
            <div class="center"><div><b>${a.pct}%</b><span>${a.correct} / ${a.total} correct</span></div></div>
          </div>
          <div>
            <div class="verdict ${a.passed ? 'pass' : 'fail'}">${a.passed ? 'Pass' : 'Below passing'}</div>
            <h2 style="font-size:30px;margin-top:4px">Estimated scaled score: ${a.scaled}<span class="muted" style="font-size:16px"> / 1000</span></h2>
            <p class="text-2" style="margin-top:6px">Passing is ${PASS_SCALED}. The real exam scores only 50 of 65 questions and uses a non-linear scale, so treat this as an estimate (≈72% raw ≈ 720).</p>
            <div class="result-stats">
              <div><b>${counts.correct}</b><span>Correct</span></div>
              <div><b>${counts.wrong}</b><span>Incorrect</span></div>
              <div><b>${counts.skipped}</b><span>Unanswered</span></div>
              <div><b>${fmtTime(a.duration)}</b><span>Time${a.timeLimit ? ` of ${fmtTime(a.timeLimit)}` : ''}</span></div>
            </div>
          </div>
        </div>
      </div>
      <div class="section grid grid-2">
        <div class="card pad-lg"><h2 style="margin-bottom:12px">By domain</h2>${domainBars(a.byDomain, '—')}</div>
        <div class="card pad-lg"><h2 style="margin-bottom:12px">By topic</h2>
          <table class="sub-table"><tbody>${topicRows.map(([k, [c, t]]) => `
            <tr class="pick" data-href="#/book/${k}"><td>${esc(topicName(k))}</td>
            <td style="width:35%"><div class="bar thin"><i style="width:${pct(c, t)}%;background:${pct(c, t) >= 72 ? 'var(--good)' : pct(c, t) >= 50 ? 'var(--warn)' : 'var(--bad)'}"></i></div></td>
            <td class="num">${c}/${t}</td></tr>`).join('')}</tbody></table>
        </div>
      </div>
      <div class="section">
        <div class="section-head"><h2>Review answers</h2></div>
        <div class="tabs">
          ${[['all', 'All'], ['wrong', 'Incorrect'], ['skipped', 'Unanswered'], ['correct', 'Correct'], ['flagged', 'Flagged']].map(([k, l]) =>
            `<button class="select-chip ${reviewFilter === k ? 'on' : ''}" data-action="review-filter" data-key="${k}">${l} (${counts[k]})</button>`).join('')}
        </div>
        ${shown.length ? shown.map(x => reviewItem(x.q, x.ans, x.i + 1, x.flag)).join('') : '<div class="empty">Nothing here.</div>'}
      </div>`;
  }

  function reviewItem(q, ans, num, flag, open = false) {
    const ok = sameSet(ans, q.answer);
    const mark = !ans.length ? '<span class="mark skip">–</span>' : ok ? '<span class="mark ok">✓</span>' : '<span class="mark no">✗</span>';
    const bookmarked = store.bookmarks.includes(q.id);
    return `<details class="review-item" ${open ? 'open' : ''}>
      <summary>${mark}<div><div class="muted small" style="margin-bottom:2px">${num ? `Q${num} · ` : ''}${esc(topicName(q.topic))}${q.subtopic ? ' · ' + esc(q.subtopic) : ''}${flag ? ' · ⚑ flagged' : ''}</div><div class="stem">${esc(q.question)}</div></div>
        ${domainChip(q.domain)}</summary>
      <div class="body">
        ${renderOptions(q, ans, true, false)}
        ${explanationBlock(q, ans)}
        <div class="row" style="margin-top:10px"><button class="btn sm ${bookmarked ? '' : 'ghost'}" data-action="bookmark-id" data-id="${q.id}">${bookmarked ? '★ Bookmarked' : '☆ Bookmark'}</button>
        <span class="muted small">${esc(q.id)} · ${DIFF[q.difficulty] || ''}</span></div>
      </div>
    </details>`;
  }

  function viewQuestionList(kind) {
    setActiveNav(kind);
    const ids = kind === 'review' ? mistakeIds().sort((a, b) => store.qstats[b].at - store.qstats[a].at) : store.bookmarks.filter(id => bank.byId[id]);
    const title = kind === 'review' ? 'Review Mistakes' : 'Bookmarks';
    const desc = kind === 'review'
      ? 'Questions whose most recent attempt was wrong. Answer one correctly and it leaves this list.'
      : 'Questions you starred during quizzes or reviews.';
    const byTopic = {};
    ids.forEach(id => { const t = bank.byId[id].topic; byTopic[t] = (byTopic[t] || 0) + 1; });
    app().innerHTML = `
      ${resumeBanner()}
      <div class="page-head"><div><h1>${title}</h1><p>${desc}</p></div>
        ${ids.length ? `<div class="row"><button class="btn primary" data-action="quiz-list" data-kind="${kind}">Quiz these ${ids.length} (practice)</button></div>` : ''}</div>
      ${ids.length ? `<div class="row" style="margin-bottom:16px">${Object.entries(byTopic).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<span class="chip">${esc(topicName(t))} · ${n}</span>`).join('')}</div>` : ''}
      ${ids.length ? ids.slice(0, listLimit).map(id => {
        const st = store.qstats[id];
        return reviewItem(bank.byId[id], [], null, false).replace('<span class="mark skip">–</span>', `<span class="mark ${kind === 'review' ? 'no' : 'skip'}">${kind === 'review' ? '✗' : '★'}</span>`)
          .replace('<div class="muted small" style="margin-bottom:2px">', `<div class="muted small" style="margin-bottom:2px">${st ? `${st.correct}/${st.seen} correct · ` : ''}`);
      }).join('') : `<div class="empty">${kind === 'review' ? 'No mistakes to review. Nice!' : 'No bookmarks yet — use ★ on any question.'}</div>`}
      ${ids.length > listLimit ? `<div class="pager"><span class="muted small">Showing ${listLimit} of ${ids.length}</span><span class="spacer"></span>
        <button class="btn" data-action="load-more">Load ${Math.min(PAGE_SIZE, ids.length - listLimit)} more</button></div>` : ''}`;
  }

  function historyTable(list) {
    return `<div class="table-wrap"><table class="table">
      <thead><tr><th>Date</th><th>Session</th><th>Mode</th><th class="num">Score</th><th class="num">Scaled</th><th class="num">Time</th></tr></thead>
      <tbody>${list.map(a => `<tr class="link" data-href="#/result/${a.id}">
        <td class="muted">${fmtDate(a.date)}</td><td>${esc(a.title)}</td><td><span class="chip">${a.mode === 'exam' ? 'Exam' : 'Practice'}</span></td>
        <td class="num">${a.correct}/${a.total} (${a.pct}%)</td>
        <td class="num"><span class="score-pill ${a.passed ? 'pass' : 'fail'}">${a.scaled}</span></td>
        <td class="num muted">${fmtTime(a.duration)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function viewHistory() {
    setActiveNav('history');
    const total = store.attempts.length;
    historyPage = Math.max(0, Math.min(historyPage, Math.ceil(total / PAGE_SIZE) - 1));
    app().innerHTML = `
      ${resumeBanner()}
      <div class="page-head"><div><h1>History</h1><p>${total} attempt${total === 1 ? '' : 's'} synced to the cloud.</p></div>
        <div class="row"><button class="btn sm" data-action="export">Export progress</button><button class="btn sm" data-action="import">Import progress</button></div></div>
      ${total ? historyTable(store.attempts.slice(historyPage * PAGE_SIZE, (historyPage + 1) * PAGE_SIZE)) + pager(historyPage, total, PAGE_SIZE, 'history-page') : '<div class="empty">No attempts yet.</div>'}
      <div class="section danger-zone">
        <div><h3>Danger zone</h3><p class="small text-2">Delete every exam attempt, statistic and bookmark, on this device and in the cloud. Book pages and your notes are kept. Export first if you want a backup.</p></div>
        <button class="btn danger" data-action="reset">Reset all progress</button>
      </div>`;
  }

  function viewGuide() {
    setActiveNav('guide');
    const tasks = {
      secure: ['1.1 Design secure access to AWS resources (IAM, federation, multi-account, SCPs, roles)', '1.2 Design secure workloads and applications (VPC security, SG/NACL, WAF, Shield, Cognito, secrets)', '1.3 Determine appropriate data security controls (encryption at rest/in transit, KMS, ACM, backups, retention)'],
      resilient: ['2.1 Design scalable and loosely coupled architectures (SQS, SNS, EventBridge, Lambda, API Gateway, containers, caching)', '2.2 Design highly available and/or fault-tolerant architectures (Multi-AZ, multi-Region, DR strategies, Route 53, RPO/RTO)'],
      performance: ['3.1 High-performing and scalable storage solutions', '3.2 High-performing and elastic compute solutions', '3.3 High-performing database solutions (read replicas, caching, Aurora, DynamoDB)', '3.4 High-performing and scalable network architectures (CloudFront, Global Accelerator, endpoints, DX)', '3.5 High-performing data ingestion and transformation solutions (Kinesis, Glue, Athena, EMR)'],
      cost: ['4.1 Cost-optimized storage solutions (storage classes, lifecycle, EBS types)', '4.2 Cost-optimized compute solutions (Spot, Savings Plans, RIs, right-sizing, serverless)', '4.3 Cost-optimized database solutions', '4.4 Cost-optimized network architectures (NAT gateway costs, data transfer, endpoints, CloudFront)'],
    };
    const keywords = [
      ['LEAST operational overhead', 'Prefer fully managed / serverless (Lambda, Fargate, Aurora Serverless, DynamoDB, managed AWS features) over self-managed EC2 or custom scripts.'],
      ['MOST cost-effective', 'Spot for interruptible work, Savings Plans/RIs for steady state, S3 lifecycle/Intelligent-Tiering, gateway endpoints instead of NAT for S3/DynamoDB.'],
      ['Highly available', 'Multiple AZs (Multi-AZ RDS, ASG across AZs, ALB); one AZ or one instance is never HA.'],
      ['Decouple', 'SQS between producers and consumers; SNS fan-out; EventBridge for event routing.'],
      ['Real-time / streaming', 'Kinesis Data Streams (custom consumers, ordering per shard); Data Firehose (load to S3/Redshift/OpenSearch, near real-time).'],
      ['Global users, low latency', 'CloudFront for HTTP content caching; Global Accelerator for TCP/UDP & static anycast IPs; Route 53 latency routing.'],
      ['Private connectivity to AWS services', 'VPC gateway endpoints (S3, DynamoDB) or interface endpoints (PrivateLink) — no internet/NAT needed.'],
      ['Consistent, private, high bandwidth on-prem link', 'Direct Connect (add Site-to-Site VPN as backup or over DX for encryption).'],
      ['Encrypt with customer-controlled keys / audit', 'SSE-KMS with customer managed keys; CloudTrail logs key usage. Dedicated HSM/FIPS 140-3 L3 → CloudHSM.'],
      ['Read-heavy database', 'Read replicas or ElastiCache/DAX; Multi-AZ standby is for availability, not reads (except Multi-AZ DB cluster readers).'],
    ];
    app().innerHTML = `
      <div class="page-head"><div><h1>Exam Guide — SAA-C03</h1><p>What the real exam looks like and how this app mirrors it.</p></div></div>
      <div class="grid grid-2">
        <div class="card pad-lg">
          <h2 style="margin-bottom:12px">Format</h2>
          <ul class="list">
            <li><b>65 questions</b>: 50 scored + 15 unscored (pre-test) questions that you cannot tell apart.</li>
            <li><b>130 minutes</b>. Non-native English speakers can request the <b>ESL +30 minutes</b> accommodation before booking.</li>
            <li><b>Multiple choice</b>: 1 correct answer out of 4 options. <b>Multiple response</b>: 2 or more correct out of 5+ options ("Select TWO/THREE").</li>
            <li>Unanswered questions count as wrong and there is <b>no penalty for guessing</b> — never leave a blank.</li>
            <li>Scaled score <b>100–1000</b>, pass at <b>720</b>. Compensatory scoring: you don't have to pass each domain, only the total.</li>
            <li>Cost 150 USD; delivered at a Pearson VUE test center or online proctored. Valid for 3 years.</li>
          </ul>
          <h2 style="margin:22px 0 12px">How this app maps to it</h2>
          <ul class="list">
            <li>Practice exams: 65 questions, 130 min timer, domain mix 20/17/15/13, results only after submit.</li>
            <li>All 65 questions are scored here; the scaled score is an estimate (72% ≈ 720).</li>
            <li>Topic books follow the course sections: one question per page, instant feedback, your own notes and "solve later" marks.</li>
            <li>Your progress (book pages, notes, exam history, statistics, bookmarks) is saved on this device and synced to the cloud, so it follows you to any browser after you sign in.</li>
          </ul>
        </div>
        <div class="card pad-lg">
          <h2 style="margin-bottom:14px">Content domains</h2>
          ${DKEYS.map(d => `<div class="guide-domain ${d}"><div class="row" style="justify-content:space-between"><h3>Domain ${DKEYS.indexOf(d) + 1}: ${esc(DOMAINS[d].name)}</h3><b>${DOMAINS[d].weight}%</b></div>
            <ul>${tasks[d].map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>`).join('')}
        </div>
      </div>
      <div class="section card pad-lg">
        <h2 style="margin-bottom:12px">Keyword cheat sheet</h2>
        <table class="sub-table kw-table"><tbody>${keywords.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="text-2">${esc(v)}</td></tr>`).join('')}</tbody></table>
      </div>
      <p class="muted small" style="margin-top:18px">Questions in this app are original practice questions written in the exam's style; they are not real exam questions. Always confirm details against the official AWS exam guide.</p>`;
  }

  function viewNotFound() {
    app().innerHTML = `<div class="empty">Page not found. <a href="#/">Go home</a></div>`;
  }

  // ---------- Router ----------
  function route() {
    stopTimer();
    window.scrollTo({ top: 0 });
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    const [page, arg] = parts;
    if (page !== route.lastPage) { listLimit = PAGE_SIZE; historyPage = 0; }
    route.lastPage = page;
    switch (page) {
      case '': return viewHome();
      case 'exams': return viewExams();
      case 'topics': return viewTopics();
      case 'topic': return location.replace(`#/book/${arg}`);
      case 'book': return viewBook(arg, parts[2]);
      case 'notes': return viewNotes();
      case 'custom': return viewCustom();
      case 'quiz': return viewQuiz();
      case 'result': return viewResult(arg);
      case 'review': return viewQuestionList('review');
      case 'bookmarks': return viewQuestionList('bookmarks');
      case 'history': return viewHistory();
      case 'guide': return viewGuide();
      default: return viewNotFound();
    }
  }

  function rerender() {
    const y = window.scrollY;
    route();
    window.scrollTo({ top: y });
  }

  async function guardSession(next) {
    if (store.session) {
      const ok = await confirmModal('Replace current session?', `You have an unfinished session: <b>${esc(store.session.title)}</b>. Starting a new one discards it.`, 'Discard & start new', true, 'Keep current session');
      if (!ok) return;
      store.session = null;
    }
    next();
  }

  // Queue the cloud wipe of history and stats (sent before any new uploads of those kinds)
  function startWipe() {
    store.resetAt = Date.now();
    markDirty('meta', 'reset');
    store.syncWipe = ['qstat', 'attempt'];
    store.syncPending = store.syncPending.filter(k => !k.startsWith('qstat:') && !k.startsWith('attempt:'));
  }

  function toggleBookmark(id) {
    const i = store.bookmarks.indexOf(id);
    if (i >= 0) store.bookmarks.splice(i, 1); else store.bookmarks.push(id);
    store.bookmarksAt = Date.now();
    markDirty('meta', 'bookmarks');
    saveStore();
    toast(i >= 0 ? 'Bookmark removed' : 'Bookmarked');
  }

  // ---------- Events ----------
  let downAt = null;
  document.addEventListener('mousedown', e => { downAt = [e.clientX, e.clientY]; });
  const dragged = e => e.detail > 0 && downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5;
  document.addEventListener('click', async e => {
    const href = e.target.closest('[data-href]');
    if (href && !e.target.closest('a,button')) { location.hash = href.dataset.href; return; }

    const opt = e.target.closest('[data-opt]:not([aria-disabled])');
    if (opt && dragged(e)) return; // the pointer moved: that was a text selection, not a pick
    if (opt && store.session && location.hash === '#/quiz') return selectOption(Number(opt.dataset.opt));
    if (opt && bookCtx()) return bookSelect(Number(opt.dataset.opt));

    const gotoEl = e.target.closest('[data-goto]');
    if (gotoEl) { store.session.current = Number(gotoEl.dataset.goto); saveStore(); return viewQuiz(); }

    const pref = e.target.closest('[data-pref]');
    if (pref) {
      const v = pref.dataset.val;
      store.prefs[pref.dataset.pref] = /^\d+$/.test(v) ? Number(v) : v;
      saveStore();
      return rerender();
    }

    const el = e.target.closest('[data-action]');
    if (!el) return;
    const s = store.session;
    switch (el.dataset.action) {
      case 'start-exam': {
        const ex = bank.exams.find(x => x.key === el.dataset.key);
        return guardSession(() => startSession({ kind: 'exam', title: ex.title, mode: 'exam', examKey: ex.key, qids: ex.qids, timeLimit: EXAM_MINUTES * 60 }));
      }
      case 'random-exam':
        return guardSession(() => startSession({ kind: 'exam', title: 'Random Full Exam', mode: 'exam', qids: pickWeighted(bank.questions, EXAM_SIZE), timeLimit: EXAM_MINUTES * 60 }));
      case 'half-exam':
        return guardSession(() => startSession({ kind: 'exam', title: 'Half Exam', mode: 'exam', qids: pickWeighted(bank.questions, 33), timeLimit: 65 * 60 }));
      case 'quick-quiz':
        return guardSession(() => startSession({ kind: 'topic', title: 'Quick 10 (mixed)', mode: 'practice', qids: pickWeighted(bank.questions, 10) }));
      case 'start-setup': return guardSession(startFromSetup);
      case 'discard-session': {
        const ok = await confirmModal('Discard session?', 'Your answers in this unfinished session will be lost.', 'Discard session', true, 'Keep session');
        if (ok) { store.session = null; saveStore(); rerender(); }
        return;
      }
      case 'toggle-topic': {
        const k = el.dataset.key;
        if (customTopics.has(k)) customTopics.delete(k); else customTopics.add(k);
        return rerender();
      }
      case 'pick-domain': customDomain = el.dataset.key; return rerender();
      case 'reset-filters': store.prefs.filter = 'all'; store.prefs.difficulty = 'any'; saveStore(); return rerender();
      case 'load-more': listLimit += PAGE_SIZE; return rerender();
      case 'page-check': return bookCheck();
      case 'page-prev': case 'page-next': {
        const c = bookCtx();
        if (c) gotoPage(c.key, c.i + (el.dataset.action === 'page-next' ? 1 : -1));
        return;
      }
      case 'solve-again': {
        const c = bookCtx();
        if (!c) return;
        saveBook(c.q.id, { done: false, ok: null, choice: [] });
        bookDraft = { id: c.q.id, choice: [] };
        return rerender();
      }
      case 'toggle-later': {
        const c = bookCtx();
        if (!c) return;
        const on = !bookEntry(c.q.id).later;
        saveBook(c.q.id, { later: on });
        toast(on ? 'Marked to solve later' : 'Removed from "solve later"');
        return rerender();
      }
      case 'book-star': { const c = bookCtx(); if (c) { toggleBookmark(c.q.id); rerender(); } return; }
      case 'book-filter': bookFilter = el.dataset.key; return rerender();
      case 'next-open': return bookJump(p => !bookEntry(p.id).done);
      case 'next-later': return bookJump(p => !!bookEntry(p.id).later);
      case 'history-page': historyPage = Number(el.dataset.page); return route();
      case 'prev': return go(-1);
      case 'next': return go(1);
      case 'check': return checkCurrent();
      case 'finish': return finishSession();
      case 'flag': s.flagged[s.current] = !s.flagged[s.current]; saveStore(); return viewQuiz();
      case 'bookmark': toggleBookmark(s.qids[s.current]); return viewQuiz();
      case 'bookmark-id': toggleBookmark(el.dataset.id); return rerender();
      case 'next-flagged': return jumpTo(k => s.flagged[k]);
      case 'next-unanswered': return jumpTo(k => !(s.answers[k] || []).length);
      case 'review-filter': reviewFilter = el.dataset.key; return rerender();
      case 'retry-wrong': {
        const a = store.attempts.find(x => x.id === el.dataset.id);
        const ids = a.qids.filter((_, i) => !a.results[i]);
        return guardSession(() => startSession({ kind: 'topic', title: `Retry incorrect · ${a.title}`, mode: 'practice', qids: shuffle(ids) }));
      }
      case 'retake': {
        const a = store.attempts.find(x => x.id === el.dataset.id);
        return guardSession(() => startSession({ kind: a.kind, title: a.title, mode: a.mode, examKey: a.examKey, topicKey: a.topicKey, qids: a.examKey ? a.qids : shuffle(a.qids), timeLimit: a.timeLimit }));
      }
      case 'quiz-list': {
        const kind = el.dataset.kind;
        const ids = kind === 'review' ? mistakeIds() : store.bookmarks.filter(id => bank.byId[id]);
        return guardSession(() => startSession({ kind: 'topic', title: kind === 'review' ? 'Review mistakes' : 'Bookmarked questions', mode: 'practice', qids: shuffle(ids) }));
      }
      case 'export': {
        const blob = new Blob([JSON.stringify(store)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `saa-progress-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        return;
      }
      case 'import': {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = async () => {
          let data;
          try {
            data = JSON.parse(await input.files[0].text());
            if (!Array.isArray(data.attempts) || typeof data.qstats !== 'object') throw new Error('bad file');
          } catch (_) { return toast('That file is not a progress export'); }
          const ok = await confirmModal('Replace your progress?',
            `Importing replaces your current ${store.attempts.length} attempt(s), statistics and bookmarks with the ${data.attempts.length} attempt(s) in this file. Export first if you want to keep the current data.`,
            'Replace with file', true, 'Keep current progress');
          if (!ok) return;
          // Replace history, stats and bookmarks here and in the cloud; book pages and notes stay as they are
          store.attempts = data.attempts.filter(a => a && a.id && a.date).slice(0, 300);
          store.qstats = data.qstats || {};
          store.bookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
          store.bookmarksAt = Date.now();
          startWipe();
          Object.keys(store.qstats).forEach(id => markDirty('qstat', id));
          store.attempts.forEach(a => markDirty('attempt', a.id));
          markDirty('meta', 'bookmarks');
          saveStore();
          toast('Progress imported');
          rerender();
        };
        input.click();
        return;
      }
      case 'reset': {
        const ok = await confirmModal('Reset all progress?', 'This deletes every exam attempt, statistic and bookmark on this device and in the cloud. Book pages and your notes are kept.', 'Reset everything', true, 'Keep my progress');
        if (ok) {
          Object.assign(store, { attempts: [], qstats: {}, bookmarks: [], bookmarksAt: Date.now(), session: null });
          startWipe();
          markDirty('meta', 'bookmarks');
          saveStore();
          rerender();
        }
        return;
      }
    }
  });

  // Notes autosave: local immediately, cloud after a short pause in typing
  document.addEventListener('input', e => {
    if (e.target.id !== 'pageNote') return;
    saveBook(e.target.dataset.qid, { note: e.target.value.slice(0, 20000) }, 800);
    setCloud('syncing');
  });

  function bookKeys(e) {
    const c = bookCtx();
    if (!c) return;
    const k = e.key.toLowerCase();
    const done = bookEntry(c.q.id).done;
    if (/^[1-6]$/.test(k)) return bookSelect(Number(k) - 1);
    if (/^[a-f]$/.test(k)) return bookSelect(k.charCodeAt(0) - 97);
    if (k === 'arrowright' && c.i < c.pages.length - 1) return gotoPage(c.key, c.i + 1);
    if (k === 'arrowleft' && c.i > 0) return gotoPage(c.key, c.i - 1);
    if (k === 'm') return $('[data-action="toggle-later"]').click();
    if (k === 's') return $('[data-action="book-star"]').click();
    if (k === 'n') { e.preventDefault(); return $('#pageNote').focus(); }
    if (k === 'enter') {
      e.preventDefault();
      if (!done) return bookCheck();
      if (c.i < c.pages.length - 1) return gotoPage(c.key, c.i + 1);
    }
  }

  document.addEventListener('keydown', e => {
    if (e.key === ' ' && e.target.matches('[data-opt][tabindex]')) { e.preventDefault(); return e.target.click(); }
    if (!$('#modal').hidden || e.ctrlKey || e.metaKey || e.altKey || /input|select|textarea/i.test(e.target.tagName)) return;
    if (location.hash.startsWith('#/book/')) return bookKeys(e);
    if (location.hash !== '#/quiz' || !store.session) return;
    const k = e.key.toLowerCase();
    const s = store.session;
    if (/^[1-6]$/.test(k)) return selectOption(Number(k) - 1);
    if (/^[a-f]$/.test(k)) return selectOption(k.charCodeAt(0) - 97);
    if (k === 'arrowright') return go(1);
    if (k === 'arrowleft') return go(-1);
    if (k === 'm') { s.flagged[s.current] = !s.flagged[s.current]; saveStore(); return viewQuiz(); }
    if (k === 's') { toggleBookmark(s.qids[s.current]); return viewQuiz(); }
    if (k === 'enter') {
      e.preventDefault();
      const i = s.current;
      if (s.mode === 'practice' && !s.checked[i]) return checkCurrent();
      if (i === s.qids.length - 1) return finishSession();
      return go(1);
    }
  });

  $('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', saveStore);

  // ---------- Boot ----------
  // ---------- Account (cookies set by login.js, checked by the CloudFront function) ----------
  const readCookie = name => (document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)')) || [])[1];
  function renderAccount() {
    const user = readCookie('saa_user');
    $('#topbarRight').innerHTML = user
      ? `<span class="account"><span class="account-dot"></span>${esc(decodeURIComponent(user))}</span>
         <button class="btn sm ghost" data-action="sign-out">Sign out</button>`
      : '';
  }
  function signOut() {
    ['saa_auth', 'saa_user'].forEach(n => (document.cookie = `${n}=; Path=/; Max-Age=0; Secure; SameSite=Lax`));
    location.href = '/login.html';
  }

  function boot() {
    app().innerHTML = '<div class="loading">Loading question bank…</div>';
    loadBank().then(() => {
      route();
      setCloud(cloud.state);
      pull().then(ok => ok && rerenderIfIdle());
    }).catch(err => {
      console.error('Failed to load question bank', err);
      app().innerHTML = `<div class="empty">
        <h3 style="color:var(--text);margin-bottom:6px">We couldn't load the questions</h3>
        <p style="margin-bottom:16px">Check that the practice server is running (<code>npm start</code> in the project folder), then try again.</p>
        <button class="btn primary" data-action="retry-load">Try again</button></div>`;
    });
  }
  document.addEventListener('click', e => {
    if (e.target.closest('[data-action="retry-load"]')) boot();
    if (e.target.closest('[data-action="sign-out"]')) signOut();
  });

  loadStore();
  renderAccount();
  boot();
})();
