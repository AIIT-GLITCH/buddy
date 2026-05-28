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

  // Paid — route to the right success page based on amount.
  const amount = session.amount_total || 0;

  // Voice2 is $50 (5000 cents).
  if (amount === 5000) {
    return Response.redirect(`${url.origin}/voice2-success?session_id=${encodeURIComponent(sessionId)}`, 302);
  }

  // LAC is $2–$50 pay what you want.
  return Response.redirect(`${url.origin}/lac-success?session_id=${encodeURIComponent(sessionId)}`, 302);
}
