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
    let st;
    try {
      st = statSync(path);
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      throw err;
    }
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
  const papersLink = '<a href="/papers">Papers</a>';
  if (!html.includes(papersLink) || html.includes('<a href="/paper-game">Paper Game</a>')) return html;
  return html.replace(papersLink, `${papersLink}\n          <a href="/paper-game">Paper Game</a>`);
}

function removeUpdateStrip(html) {
  return html.replace(/\s*<div class="update-strip">[\s\S]*?<\/div>\s*/g, '\n');
}

function replaceHeroHook(html) {
  return html
    .replace(/<a href="#hero-joke-anchor" class="hp-joke-secondary" data-hs="joke">or tell buddy a joke\.<\/a>/g,
      '<a href="/paper-game" class="hp-joke-secondary">there is a back door into the archive →</a>')
    .replace(/or tell buddy a joke\./g, 'there is a back door into the archive →');
}

function paperGameBlock() {
  return `
  <section id="paper-game-home" data-anim="card-slide-in">
    <div class="container narrow pgh-inner">
      <div class="eyebrow">Paper Game</div>
      <h2 class="pgh-head">the archive has<br><span>a back door.</span></h2>
      <p class="pgh-body">Three questions a day. Each answer opens a paper. Most people browse the archive from the front. This is the other way in.</p>
      <div class="pgh-actions">
        <a href="/paper-game" class="pgh-cta">find today's door →</a>
        <a href="/papers" class="pgh-link">or browse normally</a>
      </div>
      <div class="pgh-cards" aria-label="Paper Game features">
        <a href="/paper-game" class="pgh-card">
          <span class="pgh-card-k">01</span>
          <strong>Answer three</strong>
          <span>daily questions from the giants.</span>
        </a>
        <a href="/paper-game" class="pgh-card">
          <span class="pgh-card-k">02</span>
          <strong>Unlock papers</strong>
          <span>one by one, instead of facing the wall.</span>
        </a>
        <a href="/paper-game" class="pgh-card">
          <span class="pgh-card-k">03</span>
          <strong>Keep the map</strong>
          <span>your collection follows your login.</span>
        </a>
      </div>
    </div>
  </section>
  <style>
    #paper-game-home { min-height: auto; padding: 96px 6vw; }
    .pgh-inner { border: 1px solid rgba(212,160,96,0.24); border-radius: 22px; padding: clamp(28px, 5vw, 54px); background: radial-gradient(circle at 20% 10%, rgba(212,160,96,0.12), transparent 38%), linear-gradient(180deg, rgba(255,255,255,0.024), rgba(255,255,255,0.008)); box-shadow: 0 18px 80px rgba(0,0,0,0.22); }
    .pgh-head { font-family: Georgia, serif; font-size: clamp(36px, 6vw, 72px); line-height: 1.05; margin: 0 0 18px; color: var(--ink); }
    .pgh-head span { color: var(--amber); text-shadow: 0 0 22px rgba(212,160,96,0.22); }
    .pgh-body { max-width: 740px; color: var(--ink-soft); font-size: clamp(16px, 1.6vw, 20px); line-height: 1.7; margin: 0 0 28px; }
    .pgh-actions { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; margin-bottom: 26px; }
    .pgh-cta, .pgh-link { font-family: 'Courier New', monospace; letter-spacing: 0.18em; text-transform: uppercase; text-decoration: none; color: var(--amber); }
    .pgh-cta { border: 1px solid rgba(212,160,96,0.55); border-radius: 999px; padding: 12px 22px; background: rgba(212,160,96,0.09); }
    .pgh-cta:hover, .pgh-link:hover { color: #ffd166; border-color: #ffd166; }
    .pgh-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 10px; }
    .pgh-card { display: grid; gap: 8px; padding: 18px; border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; background: rgba(0,0,0,0.18); text-decoration: none; color: var(--ink-soft); min-height: 132px; }
    .pgh-card:hover { border-color: rgba(212,160,96,0.45); background: rgba(212,160,96,0.045); transform: translateY(-1px); }
    .pgh-card-k { font-family: 'Courier New', monospace; letter-spacing: 0.2em; color: var(--amber); font-size: 9pt; }
    .pgh-card strong { font-family: Georgia, serif; color: var(--ink); font-size: 20px; }
    .pgh-card span:last-child { line-height: 1.55; }
    @media (max-width: 820px) { .pgh-cards { grid-template-columns: 1fr; } }
  </style>
`;
}

function addHome(html) {
  if (!html.includes('<section id="hero"')) return html;
  let next = removeUpdateStrip(replaceHeroHook(html));
  if (next.includes('id="paper-game-home"')) return next;
  const marker = '<!-- 5. FRAMEWORK TEASER -->';
  if (next.includes(marker)) return next.replace(marker, paperGameBlock() + '\n  ' + marker);
  const fallback = '<section id="framework-teaser"';
  if (next.includes(fallback)) return next.replace(fallback, paperGameBlock() + '\n  ' + fallback);
  return next;
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

console.log(`[paper-game-sync] injected sync and robust Paper Game placement into ${touched} HTML files.`);
