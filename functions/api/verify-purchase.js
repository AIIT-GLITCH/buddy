export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id');

  if (!sessionId) {
    return Response.redirect(`${url.origin}/lac`, 302);
  }

  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
    },
  });

  if (!res.ok) {
    return Response.redirect(`${url.origin}/lac`, 302);
  }

  const session = await res.json();

  if (session.payment_status !== 'paid') {
    return Response.redirect(`${url.origin}/lac`, 302);
  }

  // Check which product they bought and redirect to the right success page
  const amount = session.amount_total || 0;

  // Voice2 is $50 (5000 cents)
  if (amount === 5000) {
    return Response.redirect(`${url.origin}/voice2-success`, 302);
  }

  // LAC is $2-$50 pay what you want
  return Response.redirect(`${url.origin}/lac-success`, 302);
}
