import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.cwd();
const dist = resolve(root, 'dist');
const marker = '/paper-game-sync.js';
const tag = '<script src="/paper-game-sync.js" defer></script>';

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

let touched = 0;
for (const file of walk(dist)) {
  let html = readFileSync(file, 'utf8');
  if (html.includes(marker)) continue;
  if (html.includes('</body>')) {
    html = html.replace('</body>', `${tag}\n</body>`);
  } else {
    html += `\n${tag}\n`;
  }
  writeFileSync(file, html);
  touched++;
}

console.log(`[paper-game-sync] injected sync client into ${touched} HTML files.`);
