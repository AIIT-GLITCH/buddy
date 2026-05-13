import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const apiFiles = [
  'functions/api/askbuddy.js',
  'functions/api/askbuddy_poll.js',
  'functions/api/joke.js',
];

let failed = false;

function fail(message) {
  console.error(message);
  failed = true;
}

function readProjectFile(file) {
  return readFileSync(resolve(root, file), 'utf8');
}

for (const file of apiFiles) {
  const text = readProjectFile(file);
  if (/['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/.test(text)) {
    fail(`[site-integrity-guard] wildcard CORS is not allowed in ${file}.`);
  }
  if (text.includes('[-a-z0-9]+\\.pages\\.dev') && !text.includes('buddy-bb4\\.pages\\.dev')) {
    fail(`[site-integrity-guard] broad Cloudflare Pages origin allowlist is not allowed in ${file}; scope it to this project.`);
  }
}

for (const file of ['functions/api/askbuddy.js', 'functions/api/askbuddy_poll.js']) {
  const text = readProjectFile(file);
  if (!/requestFromAllowedSurface/.test(text)) {
    fail(`[site-integrity-guard] ${file} must validate browser origin/referer before backend access.`);
  }
  if (!text.includes('buddy-bb4\\.pages\\.dev')) {
    fail(`[site-integrity-guard] ${file} must scope Cloudflare Pages previews to buddy-bb4.pages.dev.`);
  }
}

const paperIndex = readProjectFile('scripts/build-paper-index.mjs');
if (!/CANONICAL_MAX_PAPER\s*=\s*154/.test(paperIndex)) {
  fail('[site-integrity-guard] build-paper-index.mjs must enforce canonical max paper number 154.');
}
if (/nextNum\s*=\s*maxNum\s*\+\s*1/.test(paperIndex) || /p\.num\s*=\s*newNumStr/.test(paperIndex)) {
  fail('[site-integrity-guard] build-paper-index.mjs must not create new public paper numbers for collisions.');
}

if (failed) {
  process.exit(1);
}

console.log('[site-integrity-guard] Public API and paper-number integrity checks passed.');
