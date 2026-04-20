#!/usr/bin/env node
// Scans PRINT_READY for PAPER_*.pdf, emits:
//   src/data/papers.json  — array of { id, num, slug, title, tag, filename }
//   public/papers/        — copied PDF files so Astro can serve them
import { readdirSync, copyFileSync, mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const ROOT       = resolve(__dirname, '..');
const SOURCE_DIR = '/home/buddy_ai/Desktop/PRINT_READY';
const OUT_PDF    = resolve(ROOT, 'public/papers');
const OUT_JSON   = resolve(ROOT, 'src/data/papers.json');

// Tag assignment from filename keywords — extend as new domains land
const tagRules = [
  [/SOURCE_FIELD|SYNTHESIS|FOUNDATION/,          'Foundation'],
  [/KEEPER/,                                     'Keeper'],
  [/PAINTING|RETRIEVAL/,                         'Temporal Prior'],
  [/MEANING_OF_LIFE|BOTTOM_OF_THE_OCEAN|FEVER/,  'God Equation'],
  [/WEATHER|PLANETARY|SENSOR/,                   'Weather'],
  [/CANCER/,                                     'Oncology'],
  [/DEATH|AFTERLIFE/,                            'Phase Transition'],
  [/DEPRESSION|PTSD|TRAUMA|ABUSE|ANXIETY/,       'Medical · Mind'],
  [/ALZHEIMER|HRV|CARDIAC|IMMUNE|FEVER|PAIN/,    'Medical'],
  [/BLACK_HOLE|SINGULARITY|GATE|ONE_SINGULARITY/,'Singularities'],
  [/SCHUMANN|0\.1|HZ_|HUM/,                      '0.1 Hz'],
  [/GOLDEN_RATIO|PI_|BOUNDARY|WINDING/,          'Geometry'],
  [/CIVILIZATION|CIVILIZATIONAL|SOCIAL|GRANOVETTER/, 'Macro'],
  [/CONSCIOUSNESS|NEURAL|GAMMA|FLOW_STATE/,      'Mind'],
  [/COSMIC|COSMOLOG|GALAXY|DARK_MATTER|CMB/,     'Cosmology'],
  [/ANOMAL|VALIDATION|CONVERGENCE|MASTER_SUMMARY/, 'Validation'],
  [/IBM|QUANTUM|BELL|LINDBLAD|ENAQT/,            'Quantum'],
  [/LOVE|EMOTION|SOUL|APHRODITE/,                'Heart'],
  [/WATER|LIFE_COHERENCE|ORIGIN_OF_LIFE/,        'Water · Life'],
  [/RAPTOR|COMBUSTION|CAR|ENGINE/,               'Applied'],
];

// Title prettifier: PAPER_27_THE_MEANING_OF_LIFE.pdf → "The Meaning of Life"
function prettify(stem) {
  // strip PAPER_NN_ prefix
  const body = stem.replace(/^PAPER_\d+[A-Z]?_/, '');
  // underscore → space, lower, upper-case words, fix common tokens
  const words = body.toLowerCase().split('_');
  const small = new Set(['of', 'and', 'the', 'to', 'in', 'on', 'as', 'at', 'for', 'a', 'an', 'is']);
  const upper = new Set(['hrv','cmb','ace','acw','acpw','dna','rna','ibm','ptsd','gpu','ai','xyz','mond','z2']);
  return words
    .map((w, i) => {
      if (upper.has(w)) return w.toUpperCase();
      if (i > 0 && small.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

function tagFor(stem) {
  for (const [re, tag] of tagRules) if (re.test(stem)) return tag;
  return 'Paper';
}

if (!existsSync(SOURCE_DIR)) {
  console.error(`[build-paper-index] missing source dir: ${SOURCE_DIR}`);
  process.exit(1);
}

mkdirSync(OUT_PDF, { recursive: true });
mkdirSync(dirname(OUT_JSON), { recursive: true });

const files = readdirSync(SOURCE_DIR)
  .filter(f => /^PAPER_\d+[A-Z]?_.+\.pdf$/i.test(f))
  .sort((a, b) => {
    const na = parseInt(a.match(/^PAPER_(\d+)/)[1], 10);
    const nb = parseInt(b.match(/^PAPER_(\d+)/)[1], 10);
    return na - nb || a.localeCompare(b);
  });

const papers = files.map(f => {
  const stem     = f.replace(/\.pdf$/i, '');
  const numMatch = stem.match(/^PAPER_(\d+)([A-Z]?)/i);
  const num      = numMatch[1].padStart(3, '0');
  const suffix   = numMatch[2] || '';
  const slug     = (num + suffix).toLowerCase();
  const title    = prettify(stem);
  const tag      = tagFor(stem);
  return { id: stem, num, suffix, slug, title, tag, filename: f };
});

// Dedupe by num: when multiple PDFs share PAPER_NN_, the LAST one (alphabetically
// last in PRINT_READY) keeps the original num and matches what's been live.
// Earlier "loser" entries get reassigned to fresh paper numbers starting at maxNum+1
// so every entry in papers.json has a unique slug — Astro can build one route per paper.
{
  let maxNum = 0;
  papers.forEach(p => { const n = parseInt(p.num, 10); if (n > maxNum) maxNum = n; });
  const lastIdxByKey = {};
  papers.forEach((p, i) => { lastIdxByKey[p.num + p.suffix] = i; });
  let nextNum = maxNum + 1;
  papers.forEach((p, i) => {
    if (lastIdxByKey[p.num + p.suffix] === i) return;
    const newNumStr = String(nextNum).padStart(3, '0');
    p.num  = newNumStr;
    p.slug = newNumStr + (p.suffix || '').toLowerCase();
    nextNum++;
  });
}

// Watermark + copyright every PDF into public/papers via stamp_pdf.py.
// Skip re-stamping if output already newer than source (cheap incremental build).
const STAMPER = resolve(__dirname, 'stamp_pdf.py');
let copied = 0, skipped = 0, failed = 0;
for (const p of papers) {
  const src = `${SOURCE_DIR}/${p.filename}`;
  const dst = `${OUT_PDF}/${p.filename}`;
  let needs = true;
  if (existsSync(dst)) {
    try {
      if (statSync(dst).mtimeMs >= statSync(src).mtimeMs) { needs = false; skipped++; }
    } catch {}
  }
  if (!needs) continue;
  const r = spawnSync('python3', [STAMPER, src, dst], { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.status === 0) {
    copied++;
  } else {
    failed++;
    console.warn(`stamp failed for ${p.filename}:`, r.stderr?.toString?.() || r.error);
    // fallback: copy unstamped so the site still works
    try { copyFileSync(src, dst); } catch {}
  }
}

writeFileSync(OUT_JSON, JSON.stringify(papers, null, 2));

console.log(`[build-paper-index] ${papers.length} papers indexed, ${copied} PDFs copied -> public/papers/`);
console.log(`[build-paper-index] metadata -> ${OUT_JSON}`);
