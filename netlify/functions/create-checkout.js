// ============================================================
// netlify/functions/create-checkout.js
// ─────────────────────────────────────────────────────────────
// Creates a Stripe Checkout session and redirects the customer.
//
// ENVIRONMENT VARIABLES TO ADD IN NETLIFY:
// (Site settings → Environment variables)
//
//   STRIPE_SECRET_KEY   your Stripe secret key (sk_live_...)
//
// SETUP CHECKLIST:
//   1. Add STRIPE_SECRET_KEY to Netlify environment variables
//   2. Replace all "price_PLACEHOLDER" in index.html with real Stripe Price IDs
//      → Create prices in Stripe dashboard → Products → Add product
//   3. Uncomment the fetch() block in index.html
//   4. Test with card: 4242 4242 4242 4242, any future date, any CVC
//   5. Switch Stripe from Test to Live mode when ready to sell for real
// ============================================================

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ============================================================
// SHIPPING RATES
// ─────────────────────────────────────────────────────────────
// All amounts in CENTS CAD (700 = $7.00).
//
// To update: change the numbers below, save, push to GitHub.
// Check current Canada Post rates at:
//   canadapost-postescanada.ca/cpc/en/tools/find-a-rate.page
// Use origin postal code: T1L (Banff, AB)
//
// CA  = Canada domestic
// US  = United States
// INT = All other international destinations
// ─────────────────────────────────────────────────────────────
const SHIPPING = {
  stickers_small: {
    // 1–5 stickers — padded envelope ~50–80g
    label: 'Standard shipping',
    CA: 700, US: 1200, INT: 1500,
  },
  stickers_large: {
    // 6+ stickers — heavier envelope ~100–150g
    label: 'Standard shipping',
    CA: 900, US: 1400, INT: 1700,
  },
  prints_self: {
    // 5×7, 6×6, 8×10 — rigid mailer ~150–250g
    label: 'Standard shipping (rigid mailer)',
    CA: 1000, US: 1500, INT: 2000,
  },
  originals: {
    // Original artwork — reinforced packaging
    label: 'Insured shipping (original artwork)',
    CA: 1500, US: 2200, INT: 2800,
  },
  // Printful items (11×14, 16×20, shirts, totes) ship directly from
  // Printful. They handle their own shipping — no entry needed here.
};

// Orders with this many or more stickers use the stickers_large rate
const STICKER_LARGE_CUTOFF = 6;

// ============================================================
// ALLOWED SHIPPING COUNTRIES
// Add or remove country codes as needed.
// Full list: stripe.com/docs/api/checkout/sessions/create#shipping_address_collection-allowed_countries
// ============================================================
const ALLOWED_COUNTRIES = [
  'CA', 'US', 'GB', 'AU', 'NZ',
  'DE', 'FR', 'NL', 'SE', 'NO', 'DK', 'FI',
  'JP', 'KR', 'SG',
];

// ============================================================
// SHIPPING OPTIONS BUILDER
// ─────────────────────────────────────────────────────────────
// Returns three options (CA / US / INT) — customer picks the
// right one during checkout. Printful items excluded.
// ============================================================
function buildShippingOptions(items) {
  const selfItems = items.filter(i => i.fulfillment === 'self');
  if (selfItems.length === 0) return [];

  const hasOriginals = selfItems.some(i => i.productId.startsWith('original-'));
  const hasPrints    = selfItems.some(i => i.productId.startsWith('print-') || i.productId.startsWith('tote-'));
  const stickerQty = selfItems
    .filter(i => i.productId.startsWith('sticker-'))
    .reduce((sum, i) => sum + i.quantity, 0);

  let rateKey = 'stickers_small';
  if (hasOriginals)                             rateKey = 'originals';
  else if (hasPrints)                           rateKey = 'prints_self';
  else if (stickerQty >= STICKER_LARGE_CUTOFF) rateKey = 'stickers_large';

  const rate = SHIPPING[rateKey];

  return [
    {
      shipping_rate_data: {
        type: 'fixed_amount',
        fixed_amount: { amount: rate.CA, currency: 'cad' },
        display_name: `${rate.label} (Canada)`,
        delivery_estimate: {
          minimum: { unit: 'business_day', value: 3 },
          maximum: { unit: 'business_day', value: 7 },
        },
      },
    },
    {
      shipping_rate_data: {
        type: 'fixed_amount',
        fixed_amount: { amount: rate.US, currency: 'cad' },
        display_name: `${rate.label} (United States)`,
        delivery_estimate: {
          minimum: { unit: 'business_day', value: 7 },
          maximum: { unit: 'business_day', value: 14 },
        },
      },
    },
    {
      shipping_rate_data: {
        type: 'fixed_amount',
        fixed_amount: { amount: rate.INT, currency: 'cad' },
        display_name: `${rate.label} (International)`,
        delivery_estimate: {
          minimum: { unit: 'business_day', value: 10 },
          maximum: { unit: 'business_day', value: 21 },
        },
      },
    },
  ];
}

// ============================================================
// HANDLER
// ============================================================
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let items, discounts;
  try {
    ({ items, discounts } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: 'Invalid request body' };
  }

  // Guard: reject placeholder Price IDs
  const hasPlaceholder = items.some(i => !i.stripePrice || i.stripePrice === 'price_PLACEHOLDER');
  if (hasPlaceholder) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'One or more products are missing a Stripe Price ID.' }),
    };
  }

  // ── Line items ────────────────────────────────────────────
  const lineItems = items.map(item => ({
    price:    item.stripePrice,
    quantity: item.quantity,
  }));

  // ── Discounts ─────────────────────────────────────────────
  // If the cart has bundle discounts, create a one-time Stripe coupon
  // for the exact discount amount and apply it to this session.
  // This ensures Stripe charges the correct discounted total.
  let stripeCoupons = [];
  if (discounts && discounts.length > 0) {
    const totalSavingsCents = discounts.reduce((s, d) => s + d.savingsCents, 0);
    if (totalSavingsCents > 0) {
      try {
        const coupon = await stripe.coupons.create({
          amount_off: totalSavingsCents,
          currency:   'cad',
          duration:   'once',
          name:       discounts.map(d => d.label).join(' + '),
          // max_redemptions: 1 — Stripe doesn't support this on one-time coupons
          // but that's fine — these are auto-generated per session
        });
        stripeCoupons = [{ coupon: coupon.id }];
      } catch (err) {
        console.error('Failed to create discount coupon:', err.message);
        // Non-fatal — session proceeds without discount rather than failing
      }
    }
  }

  // ── Session metadata ──────────────────────────────────────
  // Stored on the Stripe session — readable in webhook + dashboard
  const metadata = {
    order_items: JSON.stringify(items.map(i => ({
      productId:         i.productId,
      size:              i.size,
      quantity:          i.quantity,
      fulfillment:       i.fulfillment,
      printfulVariantId: i.printfulVariantId,
    }))),
    discounts_applied: discounts
      ? JSON.stringify(discounts.map(d => ({ label: d.label, savingsCents: d.savingsCents })))
      : '[]',
  };

  // ── Create session ────────────────────────────────────────
  const shippingOptions = buildShippingOptions(items);

  try {
    const sessionParams = {
      mode:       'payment',
      currency:   'cad',
      line_items: lineItems,
      metadata,
      shipping_address_collection: {
        allowed_countries: ALLOWED_COUNTRIES,
      },
      // Enable Stripe's automatic receipt email to the customer
      // (also configure in Stripe dashboard → Settings → Emails)
      success_url: 'https://tunakawano.com/success.html?session={CHECKOUT_SESSION_ID}',
      cancel_url:  'https://tunakawano.com/#shop',
    };

    if (shippingOptions.length > 0) {
      sessionParams.shipping_options = shippingOptions;
    }

    if (stripeCoupons.length > 0) {
      sessionParams.discounts = stripeCoupons;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error('Stripe session error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
