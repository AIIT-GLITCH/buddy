import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.cwd();
const dist = resolve(root, 'dist');
const syncMarker = '/paper-game-sync.js';
const syncTag = '<script src="/paper-game-sync.js" defer></script>';

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) out.push(...walk(path));
    else if (name.endsWith('.html')) out.push(path);
  }
  return out;
}

function addSync(html) {
  if (html.includes(syncMarker)) return html;
  return html.includes('</body>') ? html.replace('</body>', `${syncTag}\n</body>`) : `${html}\n${syncTag}\n`;
}

function addNav(html) {
  if (html.includes('href="/paper-game"')) return html;
  return html.replace('<a href="/papers">Papers</a>', '<a href="/papers">Papers</a>\n          <a href="/paper-game">Paper Game</a>');
}

function addHome(html) {
  if (!html.includes('<section id="hero"') || html.includes('id="paper-game-home"')) return html;
  html = html.replace(
    '<a href="#hero-joke-anchor" class="hp-joke-secondary" data-hs="joke">or tell buddy a joke.</a>',
    '<a href="/paper-game" class="hp-joke-secondary">learn the papers by unlocking them →</a>'
  );
  const block = `
  <section id="paper-game-home" data-anim="card-slide-in">
    <div class="container narrow pgh-inner">
      <div class="eyebrow">Paper Game</div>
      <h2 class="pgh-head">learn the system<br><span>by unlocking it.</span></h2>
      <p class="pgh-body">Three questions a day. Each answer opens a paper. The archive stops being a wall and starts becoming a map.</p>
      <div class="pgh-actions">
        <a href="/paper-game" class="pgh-cta">play the paper game →</a>
        <a href="/papers" class="pgh-link">browse the archive</a>
      </div>
    </div>
  </section>
  <style>
    #paper-game-home { min-height: auto; padding: 96px 6vw; }
    .pgh-inner { border: 1px solid rgba(212,160,96,0.22); border-radius: 22px; padding: clamp(28px, 5vw, 54px); background: radial-gradient(circle at 20% 10%, rgba(212,160,96,0.10), transparent 38%), rgba(255,255,255,0.018); }
    .pgh-head { font-family: Georgia, serif; font-size: clamp(36px, 6vw, 72px); line-height: 1.05; margin: 0 0 18px; color: var(--ink); }
    .pgh-head span { color: var(--amber); }
    .pgh-body { max-width: 680px; color: var(--ink-soft); font-size: clamp(16px, 1.6vw, 20px); line-height: 1.7; margin: 0 0 28px; }
    .pgh-actions { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; }
    .pgh-cta, .pgh-link { font-family: 'Courier New', monospace; letter-spacing: 0.18em; text-transform: uppercase; text-decoration: none; color: var(--amber); }
    .pgh-cta { border: 1px solid rgba(212,160,96,0.5); border-radius: 999px; padding: 12px 22px; background: rgba(212,160,96,0.08); }
    .pgh-cta:hover, .pgh-link:hover { color: #ffd166; border-color: #ffd166; }
  </style>
`;
  return html.replace('  <!-- 5. FRAMEWORK TEASER -->', block + '\n  <!-- 5. FRAMEWORK TEASER -->');
}

let touched = 0;
for (const file of walk(dist)) {
  const before = readFileSync(file, 'utf8');
  let html = addHome(addNav(addSync(before)));
  if (html !== before) {
    writeFileSync(file, html);
    touched++;
  }
}

console.log(`[paper-game-sync] injected sync and Paper Game placement into ${touched} HTML files.`);
