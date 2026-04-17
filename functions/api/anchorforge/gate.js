// AnchorForge v5 site gate.
// POST { raw_output: string }
// - Requires aiit_session cookie (GitHub login)
// - Rate limits per GitHub login (1/week free, 1/day pro — pro not wired yet)
// - Extracts URLs, HEAD-pings each, computes Gate Multiplier
// - Calls Sonnet 4.6 for the epistemic read
// - Writes markdown record to AIIT-GLITCH/anchorforge-site-log
// - Returns { commit_url, sha256, gate_multiplier, anchors, model_claimed, verdict }

const GATE_MODEL = 'claude-sonnet-4-6';
const SITE_LOG_REPO = 'AIIT-GLITCH/anchorforge-site-log';

function parseSessionFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  for (const p of cookieHeader.split(';').map(s => s.trim())) {
    if (p.startsWith('aiit_session=')) return p.slice('aiit_session='.length);
  }
  return null;
}

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function extractUrls(text) {
  const re = /https?:\/\/[^\s)<>"'\]}]+/g;
  const seen = new Set();
  const urls = [];
  for (const m of text.matchAll(re)) {
    let u = m[0].replace(/[.,;:!?)>\]]+$/, '');
    if (!seen.has(u)) { seen.add(u); urls.push(u); }
  }
  return urls;
}

async function pingAnchor(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    let res;
    try {
      res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal });
    } catch {
      res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
    }
    clearTimeout(t);
    return { url, status: res.status, alive: res.status >= 200 && res.status < 400 };
  } catch (e) {
    return { url, status: 0, alive: false, error: String(e).slice(0, 120) };
  }
}

function gateMultiplier(anchorResults) {
  const dead = anchorResults.filter(a => !a.alive).length;
  if (dead === 0) return 1.0;
  if (dead === 1) return 0.7;
  return 0.0;
}

function modelSlugFromRaw(raw) {
  const firstLines = raw.split('\n').slice(0, 5).join(' ');
  const m = firstLines.match(/(?:model|i am|i'm)\s*[:\-]?\s*([A-Za-z0-9._\-\/]+)/i);
  const slug = (m ? m[1] : 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48);
  return { claimed: m ? m[1] : 'unknown', slug };
}

async function callSonnet(apiKey, rawOutput, anchorResults) {
  const anchorSummary = anchorResults.map(a => `${a.alive ? '✓' : '✗'} ${a.url} (${a.status})`).join('\n');
  const body = {
    model: GATE_MODEL,
    max_tokens: 1200,
    system: `You are the AnchorForge v5 site gate. You read raw output from an AI that was asked to make 5 pre-2026 niche factual claims, each with 3 anchors (tiered T1/T2/T3), and 3 rebuttals per claim, then self-score.

Your job: give an honest, concise epistemic read of the submission.

- Flag any claim that looks speculative, post-2026, or on the banned list.
- Flag any anchor that is irrelevant, circular (links to the AI's own output), or from a non-primary source.
- Flag calibration drift (self-score vs. what the anchors actually support).
- Be specific. Don't hedge. Don't soften. Be the most honest read possible.

Output format (strict):

## Verdict
{one line — e.g. "Strong" / "Weak" / "Invalid (banned claim)" / "Uncertified — mostly coherent" / etc.}

## Per-claim reads
1. {claim 1 read — 1-2 sentences}
2. {claim 2 read}
3. {claim 3 read}
4. {claim 4 read}
5. {claim 5 read}

## Anchor integrity
{one paragraph on anchor quality beyond liveness — relevance, tier honesty, circularity}

## Calibration
{one paragraph on self-score vs. actual support}

## Notes
{anything worth saying that doesn't fit above — 0-3 sentences}

Here is the anchor liveness map from HEAD pings (separate from relevance):
${anchorSummary}`,
    messages: [
      { role: 'user', content: `Here is the raw AnchorForge v5 output to gate:\n\n---\n${rawOutput}\n---` },
    ],
  };

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Anthropic error ${r.status}: ${err.slice(0, 240)}`);
  }
  const data = await r.json();
  return data.content?.[0]?.text || '(no verdict)';
}

function buildMarkdown({ user, timestamp, modelClaimed, sha, rawOutput, verdict, anchors, gateMult }) {
  const anchorTable = anchors.length
    ? anchors.map(a => `| ${a.alive ? '✓ alive' : '✗ dead'} | ${a.status} | ${a.url} |`).join('\n')
    : '| — | — | (no URLs extracted) |';
  return `# AnchorForge site-gated run

- **Timestamp (UTC):** ${timestamp}
- **Submitted by:** @${user.login} (id ${user.id})
- **Claimed model:** \`${modelClaimed}\`
- **Gate model:** \`${GATE_MODEL}\`
- **Raw output SHA-256:** \`${sha}\`
- **Gate Multiplier:** ×${gateMult.toFixed(1)}

> **UNCERTIFIED.** This run was adjudicated by an AI (Claude Sonnet 4.6), not by two human verifiers. See [AIIT-GLITCH/anchor-forge-protocol](https://github.com/AIIT-GLITCH/anchor-forge-protocol) for the certified leaderboard.

## Sonnet 4.6 verdict

${verdict}

## Anchor liveness map

| State | Status | URL |
|-------|--------|-----|
${anchorTable}

## Raw output (verbatim)

\`\`\`
${rawOutput.replace(/```/g, '` ` `')}
\`\`\`
`;
}

async function commitToSiteLog(token, path, markdown, commitMessage) {
  const content = btoa(unescape(encodeURIComponent(markdown)));
  const url = `https://api.github.com/repos/${SITE_LOG_REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`;
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'aiit-threshold-site',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: commitMessage,
      content,
      branch: 'main',
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`GitHub write failed ${r.status}: ${err.slice(0, 240)}`);
  }
  const data = await r.json();
  return { commit_url: data.content?.html_url, sha: data.content?.sha, raw_url: data.content?.download_url };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json' };

  try {
    // --- auth ---
    const session = parseSessionFromCookie(request.headers.get('cookie'));
    if (!session || !env.AUTH_KV) {
      return new Response(JSON.stringify({ error: 'login_required' }), { status: 401, headers });
    }
    const sessionRaw = await env.AUTH_KV.get(`session:${session}`);
    if (!sessionRaw) {
      return new Response(JSON.stringify({ error: 'login_required' }), { status: 401, headers });
    }
    const user = JSON.parse(sessionRaw);

    // --- body ---
    const body = await request.json().catch(() => ({}));
    const rawOutput = (body.raw_output || '').trim();
    if (rawOutput.length < 200) {
      return new Response(JSON.stringify({ error: 'output_too_short', message: 'Paste the full protocol run — at least 200 characters.' }), { status: 400, headers });
    }
    if (rawOutput.length > 80000) {
      return new Response(JSON.stringify({ error: 'output_too_long', message: 'Max 80,000 characters.' }), { status: 400, headers });
    }

    // --- tier lookup: pro if pro:{login} in AUTH_KV and status active ---
    let tier = 'free';
    if (env.AUTH_KV) {
      const proRaw = await env.AUTH_KV.get(`pro:${user.login.toLowerCase()}`);
      if (proRaw) {
        try {
          const pro = JSON.parse(proRaw);
          if (pro.status === 'active' || pro.status === 'trialing') tier = 'pro';
        } catch {}
      }
    }

    // --- rate limit: free 1/calendar-week, pro 1/calendar-day ---
    if (env.ANCHORFORGE_KV) {
      const now = new Date();
      const key = tier === 'pro'
        ? `use:${user.login}:day:${now.toISOString().slice(0, 10)}`
        : `use:${user.login}:week:${isoWeekKey(now)}`;
      const already = await env.ANCHORFORGE_KV.get(key);
      if (already) {
        return new Response(JSON.stringify({
          error: 'rate_limited',
          tier,
          message: tier === 'pro' ? 'You already gated today. Pro = 1/day.' : 'You already gated this week. Free = 1/week — upgrade to Pro for 1/day.',
        }), { status: 429, headers });
      }
      const ttl = tier === 'pro' ? 86400 : 7 * 86400;
      await env.ANCHORFORGE_KV.put(key, '1', { expirationTtl: ttl });
    }

    // --- core work ---
    const apiKey = env.ANTHROPIC_API_KEY;
    const ghToken = env.GITHUB_WRITE_TOKEN;
    if (!apiKey || !ghToken) {
      return new Response(JSON.stringify({ error: 'server_misconfigured' }), { status: 500, headers });
    }

    const urls = extractUrls(rawOutput).slice(0, 40);
    const anchorResults = await Promise.all(urls.map(pingAnchor));
    const gateMult = gateMultiplier(anchorResults);

    const sha = await sha256Hex(rawOutput);
    const { claimed, slug } = modelSlugFromRaw(rawOutput);

    const verdict = await callSonnet(apiKey, rawOutput, anchorResults);

    const now = new Date();
    const timestamp = now.toISOString();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    const tsCompact = timestamp.replace(/[:.]/g, '-').replace(/Z$/, 'Z');
    const shortHash = sha.slice(0, 10);
    const path = `runs/${y}/${m}/${d}/${tsCompact}-${slug}-${shortHash}.md`;

    const markdown = buildMarkdown({
      user, timestamp, modelClaimed: claimed, sha, rawOutput, verdict, anchors: anchorResults, gateMult,
    });

    const commitMsg = `gate: @${user.login} · ${claimed} · ×${gateMult.toFixed(1)} · ${shortHash}`;
    const commit = await commitToSiteLog(ghToken, path, markdown, commitMsg);

    return new Response(JSON.stringify({
      ok: true,
      commit_url: commit.commit_url,
      sha256: sha,
      gate_multiplier: gateMult,
      model_claimed: claimed,
      anchors: anchorResults,
      verdict,
    }), { status: 200, headers });

  } catch (err) {
    console.error('anchorforge gate error:', err);
    return new Response(JSON.stringify({ error: 'internal', message: String(err).slice(0, 240) }), { status: 500, headers });
  }
}

function isoWeekKey(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
