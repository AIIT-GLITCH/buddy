// Cloudflare Pages Function: CORS proxy that lets browser-side Gary
// fetch a web page and get back clean text + title.
//
// POST /api/browse  body: { "url": "https://aiit-threshold.com/papers" }
// returns: { ok, url, title, text, truncated }

const MAX_CHARS = 30_000;
const TIMEOUT_MS = 25_000;
const UA = 'GaryBot/1.0 (+https://aiit-threshold.com)';

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
  const { request } = context;
  const headers = corsHeaders();

  // light origin check — same pattern as joke.js, just looser (browser tools need to be reachable)
  const origin = request.headers.get('origin') || '';
  const referer = request.headers.get('referer') || '';
  const ok = ['aiit-threshold.com', 'localhost', 'pages.dev'].some(
    h => origin.includes(h) || referer.includes(h)
  );
  if (!ok) {
    return new Response(JSON.stringify({ ok: false, error: 'origin not allowed' }), { status: 403, headers });
  }

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), { status: 400, headers }); }

  const url = (body.url || '').trim();
  let parsed;
  try { parsed = new URL(url); }
  catch { return new Response(JSON.stringify({ ok: false, error: 'invalid url' }), { status: 400, headers }); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return new Response(JSON.stringify({ ok: false, error: 'only http(s) allowed' }), { status: 400, headers });
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let html, contentType;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    contentType = r.headers.get('content-type') || '';
    if (!r.ok) {
      return new Response(JSON.stringify({ ok: false, error: `upstream ${r.status}` }), { status: 200, headers });
    }
    html = await r.text();
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'fetch failed: ' + (e.message || String(e)) }), { status: 200, headers });
  } finally {
    clearTimeout(t);
  }

  // title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim().slice(0, 300) : '';

  // strip noise then tags
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text).replace(/\s+/g, ' ').trim();

  const truncated = text.length > MAX_CHARS;
  if (truncated) text = text.slice(0, MAX_CHARS);

  return new Response(JSON.stringify({
    ok: true,
    url: parsed.toString(),
    title,
    text,
    truncated,
    content_type: contentType,
  }), { status: 200, headers });
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
