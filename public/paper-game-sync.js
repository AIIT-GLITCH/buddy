(function () {
  const KEY = 'trivia_collected_slugs';
  const URL = '/api/paper-game/collection';
  let lastSnapshot = '';
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

  function fire(slugs, user) {
    window.dispatchEvent(new CustomEvent('paper-game-collection', {
      detail: { collected_slugs: list(slugs), user: user || null }
    }));
  }

  async function sync(force) {
    if (syncing) return;
    const local = readLocal();
    const snap = snapshot(local);
    if (!force && snap === lastSnapshot) return;
    lastSnapshot = snap;
    syncing = true;

    let data;
    try {
      const res = await fetch(URL, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) { fire(local, null); return; }
      data = await res.json();
    } catch {
      fire(local, null);
      return;
    } finally {
      syncing = false;
    }

    if (!data || !data.user) {
      fire(local, null);
      return;
    }

    const merged = merge(local, data.collected_slugs);
    if (snapshot(merged) !== snapshot(local)) writeLocal(merged);

    try {
      const save = await fetch(URL, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collected_slugs: merged })
      });
      if (save.ok) data = await save.json();
    } catch {}

    const finalSlugs = list((data && data.collected_slugs) || merged);
    writeLocal(finalSlugs);
    lastSnapshot = snapshot(finalSlugs);
    fire(finalSlugs, data && data.user);
  }

  function saveUnlocked(slug) {
    const current = readLocal();
    const clean = list([slug])[0];
    if (clean && !current.includes(clean)) {
      current.push(clean);
      writeLocal(current);
      fire(current, null);
    }
    return sync(true);
  }

  window.BuddyPaperGameSync = { sync, saveUnlocked, readLocal };

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
