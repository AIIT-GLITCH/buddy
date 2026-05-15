export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id');
  const file = url.searchParams.get('file');

  if (!sessionId || !file) {
    return new Response('Missing parameters', { status: 400 });
  }

  // Verify payment with Stripe
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
  });

  if (!res.ok) {
    return new Response('Invalid session', { status: 403 });
  }

  const session = await res.json();

  if (session.payment_status !== 'paid') {
    return new Response('Payment not completed', { status: 403 });
  }

  // Allowed files — obscured names in public/
  const allowed = {
    'lac': { disk: '_dl_a8f3c1_lac.zip', name: 'lac-memory-kit-v1.0.zip' },
    'voice2': { disk: '_dl_b7e2d4_voice2.zip', name: 'aiit-voice2-v1.0.zip' },
  };

  const entry = allowed[file];
  if (!entry) {
    return new Response('Unknown file', { status: 404 });
  }

  // Fetch the file from the site's own public directory (obscured name)
  const fileRes = await fetch(`${url.origin}/${entry.disk}`);
  if (!fileRes.ok) {
    return new Response('File not found', { status: 404 });
  }

  return new Response(fileRes.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${entry.name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
