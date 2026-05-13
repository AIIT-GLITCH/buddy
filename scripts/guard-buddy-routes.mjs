import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = process.cwd();
const scannedFiles = [
  'functions/api/askbuddy.js',
  'functions/api/askbuddy_poll.js',
  'functions/api/joke.js',
  'src/pages/ask-buddy.astro',
  'src/pages/index.astro',
];
const apiFiles = [
  'functions/api/askbuddy.js',
  'functions/api/askbuddy_poll.js',
  'functions/api/joke.js',
];

const forbidden = [
  /api\.anthropic\.com/i,
  /ANTHROPIC_API_KEY/,
  /\bclaude[-\w]*/i,
  /\bcallLilHomie\b/,
  /\blil[_ -]?homie\b/i,
];

let failed = false;

function fail(message) {
  console.error(message);
  failed = true;
}

function readProjectFile(file) {
  return readFileSync(resolve(root, file), 'utf8');
}

for (const file of scannedFiles) {
  const abs = resolve(root, file);
  const text = readFileSync(abs, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      fail(`[buddy-route-guard] forbidden pattern ${pattern} in ${relative(root, abs)}`);
    }
  }
}

const askbuddy = readProjectFile('functions/api/askbuddy.js');
if (!/\bcallBuddy\b/.test(askbuddy) || !/endpoint:\s*['"]\/ask['"]/.test(askbuddy)) {
  fail('[buddy-route-guard] askbuddy.js must route through callBuddy(... endpoint: /ask).');
}

const joke = readProjectFile('functions/api/joke.js');
if (!/\bcallBuddy\b/.test(joke) || !/endpoint:\s*['"]\/ask['"]/.test(joke)) {
  fail('[buddy-route-guard] joke.js must route through callBuddy(... endpoint: /ask).');
}

const poll = readProjectFile('functions/api/askbuddy_poll.js');
if (!/\bcallBuddyPoll\b/.test(poll)) {
  fail('[buddy-route-guard] askbuddy_poll.js must route through callBuddyPoll.');
}

for (const file of apiFiles) {
  const text = readProjectFile(file);
  if (/['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/.test(text)) {
    fail(`[site-integrity-guard] wildcard CORS is forbidden in ${file}.`);
  }
  if (text.includes('[-a-z0-9]+\\.pages\\.dev') && !text.includes('buddy-bb4\\.pages\\.dev')) {
    fail(`[site-integrity-guard] broad Cloudflare Pages origin allowlist is forbidden in ${file}; scope it to this project.`);
  }
}

for (const file of ['functions/api/askbuddy.js', 'functions/api/askbuddy_poll.js']) {
  const text = readProjectFile(file);
  if (!/requestFromAllowedSurface/.test(text)) {
    fail(`[site-integrity-guard] ${file} must validate browser origin/referer before backend access.`);
  }
  if (!/buddy-bb4\\\.pages\\\.dev/.test(text)) {
    fail(`[site-integrity-guard] ${file} must scope Cloudflare Pages previews to buddy-bb4.pages.dev.`);
  }
}

const paperIndex = readProjectFile('scripts/build-paper-index.mjs');
if (!/CANONICAL_MAX_PAPER\s*=\s*154/.test(paperIndex)) {
  fail('[site-integrity-guard] build-paper-index.mjs must enforce canonical max paper number 154.');
}
if (/nextNum\s*=\s*maxNum\s*\+\s*1/.test(paperIndex) || /p\.num\s*=\s*newNumStr/.test(paperIndex)) {
  fail('[site-integrity-guard] build-paper-index.mjs must not invent new public paper numbers for collisions.');
}

if (failed) {
  process.exit(1);
}

console.log('[buddy-route-guard] Buddy routes are Cloudflare Buddy-only.');
console.log('[site-integrity-guard] Public API and paper-number integrity checks passed.');
