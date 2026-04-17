// Flap leaderboard — KV-backed top-25 list.
// GET  /api/leaderboard/flap       → { scores: [{name, score, ts}, ...] }
// POST /api/leaderboard/flap       → body {name, score}  → 200 { ok, rank, scores }

const KV_KEY = 'leaderboard:flap';
const MAX_ENTRIES = 25;
const MAX_NAME_LEN = 16;
const MAX_SCORE = 1_000_000;

function sanitizeName(raw) {
  if (typeof raw !== 'string') return 'ANON';
  const trimmed = raw.trim().slice(0, MAX_NAME_LEN);
  const cleaned = trimmed.replace(/[^\p{L}\p{N} _\-\.]/gu, '');
  return cleaned.toUpperCase() || 'ANON';
}

async function readBoard(env) {
  if (!env.AUTH_KV) return [];
  try {
    const raw = await env.AUTH_KV.get(KV_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data.scores) ? data.scores : [];
  } catch {
    return [];
  }
}

async function writeBoard(env, scores) {
  if (!env.AUTH_KV) return;
  await env.AUTH_KV.put(KV_KEY, JSON.stringify({ scores }));
}

export async function onRequestGet({ env }) {
  const scores = await readBoard(env);
  return Response.json({ scores });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }

  const name = sanitizeName(body?.name);
  const score = Math.floor(Number(body?.score));
  if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE) {
    return Response.json({ error: 'bad score' }, { status: 400 });
  }

  const scores = await readBoard(env);
  scores.push({ name, score, ts: Date.now() });
  scores.sort((a, b) => b.score - a.score);
  const trimmed = scores.slice(0, MAX_ENTRIES);
  await writeBoard(env, trimmed);

  const rank = trimmed.findIndex(s => s.name === name && s.score === score) + 1;
  return Response.json({ ok: true, rank: rank || null, scores: trimmed });
}
