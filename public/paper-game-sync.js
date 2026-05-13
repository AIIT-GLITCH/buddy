(function () {
  const KEY = 'trivia_collected_slugs';
  const URL = '/api/paper-game/collection';

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

  function fire(slugs, user) {
    window.dispatchEvent(new CustomEvent('paper-game-collection', {
      detail: { collected_slugs: list(slugs), user: user || null }
    }));
  }

  function same(a, b) {
    const x = list(a).sort();
    const y = list(b).sort();
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }

  async function sync() {
    const local = readLocal();
    let data;
    try {
      const res = await fetch(URL, { cache: 'no-store' });
      if (!res.ok) { fire(local, null); return { ok: false, collected_slugs: local }; }
      data = await res.json();
    } catch {
      fire(local, null);
      return { ok: false, collected_slugs: local };
    }

    if (!data.user) {
      fire(local, null);
      return { ok: true, user: null, collected_slugs: local };
    }

    const merged = merge(local, data.collected_slugs);
    if (!same(local, merged)) writeLocal(merged);

    if (!same(data.collected_slugs, merged)) {
      try {
        const save = await fetch(URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collected_slugs: merged })
        });
        if (save.ok) data = await save.json();
      } catch {}
    }

    const finalSlugs = list(data.collected_slugs || merged);
    writeLocal(finalSlugs);
    fire(finalSlugs, data.user || null);
    return { ok: true, user: data.user || null, collected_slugs: finalSlugs };
  }

  function saveUnlocked(slug) {
    const current = readLocal();
    const clean = list([slug])[0];
    if (clean && !current.includes(clean)) {
      current.push(clean);
      writeLocal(current);
      fire(current, null);
    }
    return sync();
  }

  window.BuddyPaperGameSync = { sync, saveUnlocked, readLocal };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, { once: true });
  else sync();
})();
