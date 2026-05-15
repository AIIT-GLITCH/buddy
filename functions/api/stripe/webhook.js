// Stripe webhook — verifies signature (no Stripe SDK, Workers-native) and
// writes pro:{github_login} -> subscription record to AUTH_KV on success,
// clears it on cancel/lapse.
//
// Required env:
//   STRIPE_WEBHOOK_SECRET   (whsec_...)
// KV binding:
//   AUTH_KV

const MAX_SIG_AGE_SECONDS = 300;

function parseSigHeader(h) {
  const out = { t: null, v1: [] };
  if (!h) return out;
  for (const p of h.split(',')) {
    const [k, v] = p.split('=');
    if (k === 't') out.t = v;
    else if (k === 'v1') out.v1.push(v);
  }
  return out;
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function verifyStripe(payload, sigHeader, secret) {
  const { t, v1 } = parseSigHeader(sigHeader);
  if (!t || v1.length === 0) return { ok: false, reason: 'missing signature parts' };

  const tsNum = parseInt(t, 10);
  if (!Number.isFinite(tsNum)) return { ok: false, reason: 'bad timestamp' };
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - tsNum);
  if (ageSec > MAX_SIG_AGE_SECONDS) return { ok: false, reason: 'stale signature' };

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = new TextEncoder().encode(`${t}.${payload}`);
  const sig = await crypto.subtle.sign('HMAC', key, signed);
  const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  const match = v1.some(v => timingSafeEqualHex(v, expected));
  return match ? { ok: true } : { ok: false, reason: 'no v1 matches' };
}

// ── Payment notification: SMS + email blast ──

const NOTIFY_SMS = [
  '9186369383@txt.att.net',   // Rhet
  '9183604790@txt.att.net',   // Wife
];

const NOTIFY_EMAIL = [
  'boss.agi@aiitcorp.com',
  'aiitthreshold@gmail.com',
  'reliablerestaurantrepair@gmail.com',
  'Wikerdw1@gmail.com',
  'GAry@aiitcorp.com',
];

async function sendNotifications(env, product, amount, customerEmail) {
  const dollars = (amount / 100).toFixed(2);
  const subject = `SALE: ${product} — $${dollars}`;
  const body = `${product}\nAmount: $${dollars}\nCustomer: ${customerEmail || 'unknown'}\nTime: ${new Date().toISOString()}`;
  const smsBody = `SALE $${dollars} — ${product} from ${customerEmail || 'unknown'}`;

  const allRecipients = [
    ...NOTIFY_SMS.map(addr => ({ to: addr, body: smsBody, isSms: true })),
    ...NOTIFY_EMAIL.map(addr => ({ to: addr, body, isSms: false })),
  ];

  const fromAddr = env.NOTIFY_FROM || 'sales@aiit-threshold.com';

  await Promise.allSettled(allRecipients.map(async (r) => {
    try {
      const msg = {
        personalizations: [{ to: [{ email: r.to }] }],
        from: { email: fromAddr, name: 'AIIT Sales' },
        subject: r.isSms ? '' : subject,
        content: [{ type: 'text/plain', value: r.isSms ? r.body : r.body }],
      };
      await fetch('https://api.mailchannels.net/tx/v1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
      });
    } catch (e) {
      console.error('notify failed:', r.to, e);
    }
  }));
}

async function setPro(env, login, data) {
  if (!login || !env.AUTH_KV) return;
  await env.AUTH_KV.put(`pro:${login.toLowerCase()}`, JSON.stringify(data));
}

async function clearPro(env, login) {
  if (!login || !env.AUTH_KV) return;
  await env.AUTH_KV.delete(`pro:${login.toLowerCase()}`);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return new Response('webhook secret not configured', { status: 500 });
  }

  const sig = request.headers.get('stripe-signature');
  const payload = await request.text();

  const ver = await verifyStripe(payload, sig, secret);
  if (!ver.ok) {
    console.error('stripe signature rejected:', ver.reason);
    return new Response('invalid signature', { status: 400 });
  }

  let evt;
  try { evt = JSON.parse(payload); } catch { return new Response('bad json', { status: 400 }); }

  const type = evt.type;
  const obj = evt.data?.object || {};

  try {
    switch (type) {
      case 'checkout.session.completed': {
        const login = obj.client_reference_id || obj.metadata?.github_login;
        const subId = obj.subscription;
        const customer = obj.customer;
        await setPro(env, login, {
          status: 'active',
          source: 'checkout.session.completed',
          subscription_id: subId || null,
          customer_id: customer || null,
          activated_at: new Date().toISOString(),
        });

        // Notify on every payment
        const productName = obj.metadata?.product
          || (obj.amount_total >= 199900 ? 'Emergency Weekend Desk'
            : obj.amount_total >= 99900 ? 'Patent/AI Evidence Binder'
            : obj.amount_total >= 49900 ? 'Founder Proof Packet'
            : obj.amount_total >= 14900 ? 'Starter Proof Seal'
            : obj.amount_total >= 5000 ? 'AIIT-Voice2'
            : obj.amount_total >= 500 ? 'wAIste Not'
            : 'AIIT Sale');
        await sendNotifications(env, productName, obj.amount_total || 0, obj.customer_details?.email || '');
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const login = obj.metadata?.github_login;
        const status = obj.status;
        if (!login) break;
        if (status === 'active' || status === 'trialing') {
          await setPro(env, login, {
            status,
            source: type,
            subscription_id: obj.id,
            customer_id: obj.customer,
            current_period_end: obj.current_period_end,
            updated_at: new Date().toISOString(),
          });
        } else {
          await clearPro(env, login);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const login = obj.metadata?.github_login;
        if (login) await clearPro(env, login);
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error('webhook handler error:', type, e);
  }

  return new Response(JSON.stringify({ received: true, type }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
