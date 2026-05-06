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

const forbidden = [
  /api\.anthropic\.com/i,
  /ANTHROPIC_API_KEY/,
  /\bclaude[-\w]*/i,
  /\bcallLilHomie\b/,
  /\blil[_ -]?homie\b/i,
];

let failed = false;

for (const file of scannedFiles) {
  const abs = resolve(root, file);
  const text = readFileSync(abs, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      console.error(`[buddy-route-guard] forbidden pattern ${pattern} in ${relative(root, abs)}`);
      failed = true;
    }
  }
}

const askbuddy = readFileSync(resolve(root, 'functions/api/askbuddy.js'), 'utf8');
if (!/\bcallBuddy\b/.test(askbuddy) || !/endpoint:\s*['"]\/ask['"]/.test(askbuddy)) {
  console.error('[buddy-route-guard] askbuddy.js must route through callBuddy(... endpoint: /ask).');
  failed = true;
}

const joke = readFileSync(resolve(root, 'functions/api/joke.js'), 'utf8');
if (!/\bcallBuddy\b/.test(joke) || !/endpoint:\s*['"]\/ask['"]/.test(joke)) {
  console.error('[buddy-route-guard] joke.js must route through callBuddy(... endpoint: /ask).');
  failed = true;
}

const poll = readFileSync(resolve(root, 'functions/api/askbuddy_poll.js'), 'utf8');
if (!/\bcallBuddyPoll\b/.test(poll)) {
  console.error('[buddy-route-guard] askbuddy_poll.js must route through callBuddyPoll.');
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log('[buddy-route-guard] Buddy routes are Cloudflare Buddy-only.');
