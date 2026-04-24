// Cloudflare Pages Function: Gary's site-write hand.
// Lets Gary read, list, and commit files in github.com/AIIT-GLITCH/buddy
// via the GitHub Contents API. Cloudflare Pages auto-deploys on push to master.
//
// Env vars required (set in CF Pages dashboard, NEVER committed):
//   GITHUB_PAT          — fine-grained PAT scoped to AIIT-GLITCH/buddy with Contents:write
//   BROKE_GARY_SECRET   — reused for HMAC-signing the per-IP write-rate cookie
//
// Endpoints (single file, switched on body.action):
//   POST /api/gary-write { action: "read",  path }
//   POST /api/gary-write { action: "list",  path }
//   POST /api/gary-write { action: "write", path, content, message, sha? }

const OWNER = 'AIIT-GLITCH';
const REPO = 'buddy';
const BRANCH = 'master';
const GH_BASE = `https://api.github.com/repos/${OWNER}/${REPO}/contents`;
const UA = 'GaryBot/1.0 (+https://aiit-threshold.com)';

const ALLOWED_PREFIXES = [
  'src/data/',
  'src/pages/',
  'src/components/',
  'src/styles/',
  'src/layouts/',
  'functions/api/',
  'PAPERS_SCHEMA.md',
  'README.md',
];
const DENIED_SUBSTRINGS = ['..', '.env', 'node_modules', '/.git', '/.github/'];
const DENIED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp3', '.mp4', '.wav', '.zip', '.tar', '.gz', '.svg'];
const DENIED_FILES = ['package-lock.json', 'package.json', 'astro.config.mjs', 'wrangler.toml', '.gitignore'];

const MAX_CONTENT_BYTES = 500 * 1024; // 500KB cap per write
const COOKIE_NAME = 'gw_writes';
const MAX_WRITES_PER_DAY = 15;

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function pathAllowed(path) {
  if (typeof path !== 'string' || !path.length) return false;
  for (const sub of DENIED_SUBSTRINGS) if (path.includes(sub)) return false;
  if (path.startsWith('/')) return false;
  const lower = path.toLowerCase();
  for (const ext of DENIED_EXTENSIONS) if (lower.endsWith(ext)) return false;
  for (const f of DENIED_FILES) if (lower.endsWith('/' + f) || lower === f) return false;
  for (const pre of ALLOWED_PREFIXES) if (path === pre || path.startsWith(pre)) return true;
  return false;
}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob((b64 || '').replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function sign(data, secret) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function todayDayNum() {
  return Math.floor(Date.now() / 86400000);
}

async function makeWriteCookie(remaining, secret) {
  const day = todayDayNum();
  const payload = String(remaining) + '.' + day;
  const sig = await sign(payload, secret);
  return payload + '.' + sig;
}
async function readWriteCookie(value, secret) {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [r, d, sig] = parts;
  let expected;
  try { expected = await sign(r + '.' + d, secret); } catch { return null; }
  if (sig !== expected) return null;
  const remaining = parseInt(r, 10);
  const day = parseInt(d, 10);
  if (Number.isNaN(remaining) || Number.isNaN(day)) return null;
  return { remaining, day };
}
function getCookie(request, name) {
  const c = request.headers.get('cookie') || '';
  for (const p of c.split(';')) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    const k = p.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(p.slice(eq + 1).trim());
  }
  return null;
}
function setCookieHeader(name, value) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${60 * 60 * 25}; HttpOnly; Secure; SameSite=Lax`;
}

async function ghGet(path, pat) {
  const url = `${GH_BASE}/${encodeURI(path)}?ref=${encodeURIComponent(BRANCH)}`;
  const r = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': UA,
    },
  });
  return r;
}

async function ghPut(path, body, pat) {
  const url = `${GH_BASE}/${encodeURI(path)}`;
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': UA,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return r;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = corsHeaders();

  // origin check (defense in depth — primary gate is owner session below)
  const origin = request.headers.get('origin') || '';
  const referer = request.headers.get('referer') || '';
  const ok = ['aiit-threshold.com', 'localhost', 'pages.dev'].some(
    h => origin.includes(h) || referer.includes(h)
  );
  if (!ok) {
    return new Response(JSON.stringify({ ok: false, error: 'origin not allowed' }), { status: 403, headers });
  }

  // OWNER-ONLY: must be logged in via GitHub OAuth as env.OWNER_LOGIN
  const ownerLogin = (env.OWNER_LOGIN || '').toLowerCase();
  if (!ownerLogin || !env.AUTH_KV) {
    return new Response(JSON.stringify({ ok: false, error: 'auth not configured (OWNER_LOGIN or AUTH_KV binding missing)' }), { status: 503, headers });
  }
  const cookie = request.headers.get('cookie') || '';
  const sessId = cookie.split(';').map(s => s.trim()).find(p => p.startsWith('aiit_session='));
  if (!sessId) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized: not logged in' }), { status: 401, headers });
  }
  const sessRaw = await env.AUTH_KV.get(`session:${sessId.slice('aiit_session='.length)}`);
  if (!sessRaw) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized: session expired' }), { status: 401, headers });
  }
  let sessUser;
  try { sessUser = JSON.parse(sessRaw); } catch { sessUser = null; }
  if (!sessUser || (sessUser.login || '').toLowerCase() !== ownerLogin) {
    return new Response(JSON.stringify({ ok: false, error: 'forbidden: owner only' }), { status: 403, headers });
  }

  const pat = env.GITHUB_PAT;
  const secret = env.BROKE_GARY_SECRET;
  if (!pat || !secret) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'gary-write not configured (GITHUB_PAT or BROKE_GARY_SECRET missing in CF Pages env)'
    }), { status: 503, headers });
  }

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), { status: 400, headers }); }

  const action = body.action || 'read';
  const path = String(body.path || '').replace(/^\/+/, '');

  if (!pathAllowed(path)) {
    return new Response(JSON.stringify({
      ok: false,
      error: `path not allowed: "${path}". allowed prefixes: ${ALLOWED_PREFIXES.join(', ')}. denied: binaries, lockfiles, env files`
    }), { status: 403, headers });
  }

  // ---------- READ ----------
  if (action === 'read') {
    const r = await ghGet(path, pat);
    if (r.status === 404) {
      return new Response(JSON.stringify({ ok: false, error: 'file not found', path }), { status: 200, headers });
    }
    if (!r.ok) {
      const t = await r.text();
      return new Response(JSON.stringify({ ok: false, error: 'github read failed: ' + r.status, detail: t.slice(0, 300) }), { status: 200, headers });
    }
    const j = await r.json();
    if (Array.isArray(j)) {
      return new Response(JSON.stringify({ ok: false, error: 'path is a directory — use action=list', path }), { status: 200, headers });
    }
    let content = '';
    try { content = b64decode(j.content || ''); } catch { content = ''; }
    return new Response(JSON.stringify({
      ok: true,
      path: j.path,
      sha: j.sha,
      size: j.size,
      content,
    }), { status: 200, headers });
  }

  // ---------- LIST ----------
  if (action === 'list') {
    const r = await ghGet(path, pat);
    if (!r.ok) {
      const t = await r.text();
      return new Response(JSON.stringify({ ok: false, error: 'github list failed: ' + r.status, detail: t.slice(0, 300) }), { status: 200, headers });
    }
    const j = await r.json();
    if (!Array.isArray(j)) {
      return new Response(JSON.stringify({ ok: false, error: 'path is a file — use action=read', path }), { status: 200, headers });
    }
    return new Response(JSON.stringify({
      ok: true,
      path,
      entries: j.map(e => ({ name: e.name, path: e.path, type: e.type, size: e.size, sha: e.sha })),
    }), { status: 200, headers });
  }

  // ---------- WRITE ----------
  if (action === 'write') {
    const content = body.content;
    if (typeof content !== 'string') {
      return new Response(JSON.stringify({ ok: false, error: 'content (string) required' }), { status: 400, headers });
    }
    const bytesLen = new TextEncoder().encode(content).length;
    if (bytesLen > MAX_CONTENT_BYTES) {
      return new Response(JSON.stringify({ ok: false, error: `content too large: ${bytesLen} bytes (cap ${MAX_CONTENT_BYTES})` }), { status: 413, headers });
    }
    const message = String(body.message || '').trim();
    if (!message) {
      return new Response(JSON.stringify({ ok: false, error: 'commit message required' }), { status: 400, headers });
    }

    // rate limit per IP via signed cookie
    const day = todayDayNum();
    const parsed = await readWriteCookie(getCookie(request, COOKIE_NAME), secret);
    let remaining;
    if (!parsed || parsed.day !== day) {
      remaining = MAX_WRITES_PER_DAY;
    } else {
      remaining = parsed.remaining;
    }
    if (remaining <= 0) {
      return new Response(JSON.stringify({ ok: false, error: `daily write quota exhausted (${MAX_WRITES_PER_DAY}/day per session). resets tomorrow.` }), { status: 429, headers });
    }
    remaining = remaining - 1;
    const newCookie = await makeWriteCookie(remaining, secret);

    const ghBody = {
      message: message.startsWith('[gary]') ? message : '[gary] ' + message,
      content: b64encode(content),
      branch: BRANCH,
      author: { name: 'Gary', email: 'gary@aiit-threshold.com' },
      committer: { name: 'Gary', email: 'gary@aiit-threshold.com' },
    };
    const sha = body.sha;
    if (sha && typeof sha === 'string') ghBody.sha = sha;

    const r = await ghPut(path, ghBody, pat);
    const txt = await r.text();
    let parsedResp = null;
    try { parsedResp = JSON.parse(txt); } catch {}

    if (!r.ok) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'github write failed: ' + r.status,
        detail: parsedResp || txt.slice(0, 400),
        hint: r.status === 409 ? 'sha mismatch — file changed since you read it. read again, retry.' : undefined,
      }), { status: 200, headers: { ...headers, 'Set-Cookie': setCookieHeader(COOKIE_NAME, await makeWriteCookie(remaining + 1, secret)) } });
      // refund the call on failure
    }

    return new Response(JSON.stringify({
      ok: true,
      path,
      commit: parsedResp && parsedResp.commit ? {
        sha: parsedResp.commit.sha,
        url: parsedResp.commit.html_url,
        message: parsedResp.commit.message,
      } : null,
      content_sha: parsedResp && parsedResp.content ? parsedResp.content.sha : null,
      writes_remaining_today: remaining,
      note: 'cloudflare pages will auto-deploy from this commit in ~30-90 seconds',
    }), { status: 200, headers: { ...headers, 'Set-Cookie': setCookieHeader(COOKIE_NAME, newCookie), 'X-Writes-Remaining': String(remaining) } });
  }

  return new Response(JSON.stringify({ ok: false, error: 'unknown action: ' + action }), { status: 400, headers });
}
