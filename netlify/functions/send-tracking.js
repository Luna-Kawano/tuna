// ============================================================
// netlify/functions/send-tracking.js
// ─────────────────────────────────────────────────────────────
// Called by ship.html when you submit a tracking number.
// Sends a shipping confirmation email to the customer.
//
// Uses the same NOTIFY_EMAIL + NOTIFY_EMAIL_PASS env vars
// already set up for order notifications — no new setup needed.
// ============================================================

const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let email, name, tracking, carrier, summary;
  try {
    ({ email, name, tracking, carrier, summary } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!email || !tracking) {
    return { statusCode: 400, body: JSON.stringify({ error: 'email and tracking are required' }) };
  }

  const notifyEmail = process.env.NOTIFY_EMAIL;
  const notifyPass  = process.env.NOTIFY_EMAIL_PASS;

  if (!notifyEmail || !notifyPass) {
    console.error('NOTIFY_EMAIL or NOTIFY_EMAIL_PASS not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Email not configured on server' }) };
  }

  const carrierName  = carrier || 'Canada Post';
  const greeting     = name ? `Hi ${name},` : 'Hi there,';
  const itemLine     = summary ? `\nOrder: ${summary}\n` : '';
  const trackingUrl  = `https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=${encodeURIComponent(tracking)}`;

  const subject = `Your Tuna Kawano order has shipped! 🐟`;

  const text = `${greeting}

Your order from Tuna Kawano has shipped!
${itemLine}
Tracking number: ${tracking}
Carrier: ${carrierName}

Track your package:
${trackingUrl}

It should arrive within 5–10 business days depending on your location. If you have any questions, just reply to this email — I'm always happy to help.

Thank you so much for your support, it means the world 🫶

Luna
tunakawano.com`.trim();

  // Simple HTML version of the same email
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="background:#f5f4f0;margin:0;padding:40px 24px;font-family:'Courier New',monospace;font-size:15px;color:#111;line-height:1.7;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:2px solid #111;padding:40px;">
    <p style="font-size:2rem;margin:0 0 20px;">🐟</p>
    <p style="margin:0 0 16px;">${greeting}</p>
    <p style="margin:0 0 16px;">Your order from <strong>Tuna Kawano</strong> has shipped!</p>
    ${summary ? `<p style="margin:0 0 16px;color:#555;">Order: ${summary}</p>` : ''}
    <div style="background:#f5f4f0;border:1px solid #ddd;padding:16px;margin:20px 0;">
      <p style="margin:0 0 6px;"><strong>Tracking number:</strong> ${tracking}</p>
      <p style="margin:0 0 12px;"><strong>Carrier:</strong> ${carrierName}</p>
      <a href="${trackingUrl}" style="color:#111;font-size:13px;">Track your package →</a>
    </div>
    <p style="margin:0 0 16px;color:#555;font-size:13px;">It should arrive within 5–10 business days depending on your location. If you have any questions, just reply to this email.</p>
    <p style="margin:24px 0 0;font-size:13px;">Thank you so much for your support, it means the world 🫶<br><br>Luna<br><a href="https://tunakawano.com" style="color:#111;">tunakawano.com</a></p>
  </div>
</body>
</html>`.trim();

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: notifyEmail, pass: notifyPass },
    });

    await transporter.sendMail({
      from:    `"Tuna Kawano" <${notifyEmail}>`,
      to:      email,
      replyTo: notifyEmail,
      subject,
      text,
      html,
    });

    console.log(`Tracking email sent to ${email} — tracking: ${tracking}`);
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error('Failed to send tracking email:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
