// Stripe Checkout success-URL verifier.
//
// Stripe Payment Link redirects here after checkout with:
//   /api/verify-purchase?session_id={CHECKOUT_SESSION_ID}
//
// On success: redirect to the right product success page.
// On failure: redirect to /lac-receipt-issue with a `reason` query param so
// the user sees what happened and can recover (retry, email us).
// NEVER silently bounce back to /lac — that leaves paying customers stranded
// with no signal, which is exactly what happened to a customer on 2026-05-27.
//
// Failure modes captured:
//   missing_session_id  — Stripe success_url didn't carry the placeholder
//   stripe_unreachable  — Stripe API HTTP error / network failure
//   not_paid_yet        — payment_status !== 'paid' (often a settle-window race)
//   verify_failed       — unexpected error / JSON parse / missing fields

function issueRedirect(origin, reason, sessionId) {
  const params = new URLSearchParams({ reason });
  if (sessionId) params.set('session_id', sessionId);
  return Response.redirect(`${origin}/lac-receipt-issue?${params.toString()}`, 302);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id');

  if (!sessionId) {
    console.error('[verify-purchase] missing_session_id', { url: url.toString() });
    return issueRedirect(url.origin, 'missing_session_id', null);
  }

  if (!env.STRIPE_SECRET_KEY) {
    console.error('[verify-purchase] STRIPE_SECRET_KEY not configured');
    return issueRedirect(url.origin, 'verify_failed', sessionId);
  }

  let res;
  try {
    res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      },
    });
  } catch (err) {
    console.error('[verify-purchase] stripe fetch threw', { sessionId, err: String(err) });
    return issueRedirect(url.origin, 'stripe_unreachable', sessionId);
  }

  if (!res.ok) {
    console.error('[verify-purchase] stripe non-ok', { sessionId, status: res.status });
    return issueRedirect(url.origin, 'stripe_unreachable', sessionId);
  }

  let session;
  try {
    session = await res.json();
  } catch (err) {
    console.error('[verify-purchase] stripe json parse failed', { sessionId, err: String(err) });
    return issueRedirect(url.origin, 'verify_failed', sessionId);
  }

  if (session.payment_status !== 'paid') {
    console.error('[verify-purchase] payment_status not paid', {
      sessionId,
      payment_status: session.payment_status,
      amount_total: session.amount_total,
    });
    return issueRedirect(url.origin, 'not_paid_yet', sessionId);
  }

  // Paid — route to the right product success page.
  //
  // Identify the product the way the Stripe webhook does: by
  // session.metadata.product, NOT by amount. LAC is pay-what-you-want
  // ($2–$50) and OVERLAPS Voice2's fixed $50, so amount alone can't tell
  // them apart — a customer who pays the full $50 for LAC would otherwise be
  // misrouted to the Voice2 success page (a product they never bought).
  // LAC is the open default; only send to Voice2 on a positive product match.
  const product = String(session.metadata?.product || '').toLowerCase();
  const amount = session.amount_total || 0;

  // Voice2 is fixed-price. Match it explicitly via product metadata. The
  // amount === 5000 check is only a legacy fallback for sessions that predate
  // metadata.product, and it only applies when no metadata is present at all.
  const isVoice2 = product.includes('voice') || (!product && amount === 5000);
  if (isVoice2) {
    return Response.redirect(`${url.origin}/voice2-success?session_id=${encodeURIComponent(sessionId)}`, 302);
  }

  // LAC (pay-what-you-want) and anything else — the open default.
  return Response.redirect(`${url.origin}/lac-success?session_id=${encodeURIComponent(sessionId)}`, 302);
}
