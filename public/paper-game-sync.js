(function () {
  const KEY = 'trivia_collected_slugs';
  const URL = '/api/paper-game/collection';
  const REMOTE_POLL_MS = 15000;
  let lastSnapshot = '';
  let lastRemotePoll = 0;
  let syncing = false;

  function list(value) {
    const arr = Array.isArray(value) ? value : [];
    const out = [];
    for (const raw of arr) {
      const slug = String(raw || '').trim().toLowerCase();
      if (slug && !out.includes(slug)) out.push(slug);
    }
    return out;
  }

  function readLocal() {
    try { return list(JSON.parse(localStorage.getItem(KEY) || '[]')); }
    catch { return []; }
  }

  function writeLocal(slugs) {
    localStorage.setItem(KEY, JSON.stringify(list(slugs)));
  }

  function merge(a, b) {
    return list([].concat(a || [], b || []));
  }

  function snapshot(slugs) {
    return list(slugs).sort().join('|');
  }

  async function postCollection(slugs) {
    const res = await fetch(URL, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collected_slugs: list(slugs) })
    });
    if (!res.ok) throw new Error('collection_save_' + res.status);
    return res.json();
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>'"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c];
    });
  }

  function activeFilter() {
    const active = document.querySelector('[data-filter].active');
    return active ? active.getAttribute('data-filter') || 'all' : 'all';
  }

  function refreshHub(slugs) {
    const papers = Array.isArray(window.__PAPER_GAME_PAPERS) ? window.__PAPER_GAME_PAPERS : [];
    if (!papers.length) return;
    const set = new Set(list(slugs));
    const unlockedCount = papers.filter(function (p) { return set.has(p.slug); }).length;
    const collectedEl = document.getElementById('pg-collected');
    const meterText = document.getElementById('pg-meter-text');
    const meterFill = document.getElementById('pg-meter-fill');
    const summary = document.getElementById('pg-collection-summary');
    if (collectedEl) collectedEl.textContent = String(unlockedCount);
    if (meterText) meterText.textContent = unlockedCount + ' unlocked';
    if (meterFill) meterFill.style.width = (papers.length ? Math.round((unlockedCount / papers.length) * 100) : 0) + '%';
    if (summary) summary.textContent = unlockedCount + ' / ' + papers.length + ' unlocked';

    const host = document.getElementById('pg-collection');
    if (!host) return;
    const filter = activeFilter();
    const filtered = papers.filter(function (p) {
      const unlocked = set.has(p.slug);
      if (filter === 'unlocked') return unlocked;
      if (filter === 'locked') return !unlocked;
      if (filter === 'keystone') return p.tier_key === 'keystone';
      return true;
    });
    host.innerHTML = filtered.map(function (p) {
      const unlocked = set.has(p.slug);
      const href = unlocked ? '/papers/' + p.slug : '/trivia';
      const action = unlocked ? 'open paper →' : 'unlock in game →';
      return '<a class="pg-card tier-' + escapeHtml(p.tier_key) + (unlocked ? ' unlocked' : ' locked') + '" href="' + href + '">' +
        '<div class="pg-card-state">' + (unlocked ? 'unlocked' : 'locked') + '</div>' +
        '<div class="pg-card-num">Paper ' + parseInt(p.num, 10) + (p.suffix || '') + '</div>' +
        '<div class="pg-card-title">' + escapeHtml(p.title) + '</div>' +
        '<div class="pg-card-tag">' + escapeHtml(p.tag) + ' · [' + escapeHtml(p.tier_label) + ']</div>' +
        '<div class="pg-card-action">' + action + '</div>' +
      '</a>';
    }).join('') || '<div class="pg-empty">No papers match this filter yet.</div>';
  }

  function fire(slugs, user) {
    const clean = list(slugs);
    refreshHub(clean);
    window.dispatchEvent(new CustomEvent('paper-game-collection', {
      detail: { collected_slugs: clean, user: user || null }
    }));
  }

  async function sync(force) {
    if (syncing) return;
    const local = readLocal();
    const snap = snapshot(local);
    const now = Date.now();
    const localChanged = snap !== lastSnapshot;
    const remotePollDue = now - lastRemotePoll >= REMOTE_POLL_MS;
    if (!force && !localChanged && !remotePollDue) return;
    lastSnapshot = snap;
    lastRemotePoll = now;
    syncing = true;

    try {
      const res = await fetch(URL, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) { fire(local, null); return; }
      let data = await res.json();

      if (!data || !data.user) {
        fire(local, null);
        return;
      }

      const merged = merge(local, data.collected_slugs);
      if (snapshot(merged) !== snapshot(local)) writeLocal(merged);

      if (snapshot(merged) !== snapshot(data.collected_slugs)) {
        try { data = await postCollection(merged); } catch {}
      }

      const finalSlugs = list((data && data.collected_slugs) || merged);
      writeLocal(finalSlugs);
      lastSnapshot = snapshot(finalSlugs);
      fire(finalSlugs, data && data.user);
    } catch {
      fire(local, null);
    } finally {
      syncing = false;
    }
  }

  function saveUnlocked(slug) {
    const current = readLocal();
    const clean = list([slug])[0];
    if (clean && !current.includes(clean)) {
      current.push(clean);
      writeLocal(current);
      fire(current, null);
    }
    return postCollection(current)
      .then(function (data) {
        const finalSlugs = merge(current, data && data.collected_slugs);
        writeLocal(finalSlugs);
        lastSnapshot = snapshot(finalSlugs);
        fire(finalSlugs, data && data.user);
        return finalSlugs;
      })
      .catch(function () {
        return sync(true);
      });
  }

  function flush() {
    const local = readLocal();
    if (!local.length) return Promise.resolve(local);
    return postCollection(local)
      .then(function (data) {
        const finalSlugs = merge(local, data && data.collected_slugs);
        writeLocal(finalSlugs);
        lastSnapshot = snapshot(finalSlugs);
        fire(finalSlugs, data && data.user);
        return finalSlugs;
      })
      .catch(function () {
        return sync(true);
      });
  }

  window.BuddyPaperGameSync = { sync, saveUnlocked, flush, readLocal };

  function start() {
    lastSnapshot = snapshot(readLocal());
    sync(true);
    setInterval(function () { sync(false); }, 2000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') sync(true);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
