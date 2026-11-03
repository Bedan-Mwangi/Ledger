// POST /api/mpesa-push
// Body: { phone: "0712345678", amount: 5400, invoiceNumber: "INV-1042", clientName: "Jane" }
// Returns: { ok: true, checkoutId: "...", message: "..." }
import { stkPush } from '../lib/mpesa.js';
import { supabase } from '../lib/db.js';

export default async function handler(req, res) {
  // Allow CORS from the browser during local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone, amount, invoiceNumber, clientName } = req.body || {};

  // --- Validate ---
  if (!phone || !amount) {
    return res.status(400).json({ error: 'Phone and amount are required' });
  }

  if (typeof amount !== 'number' || amount < 1) {
    return res.status(400).json({ error: 'Amount must be at least KES 1' });
  }

  // Normalize phone: "0712345678" or "+254712345678" → "254712345678"
  const normalized = String(phone).replace(/\s+/g, '').replace(/^\+/, '').replace(/^0/, '254');

  if (!/^2547\d{8}$/.test(normalized) && !/^2541\d{8}$/.test(normalized)) {
    return res.status(400).json({
      error: 'Enter a valid Kenyan M-Pesa number (e.g. 0712 345 678)',
    });
  }

  // --- Push ---
  try {
    const callbackUrl = `${process.env.APP_URL || 'https://example.com'}/api/mpesa-callback`;

    const result = await stkPush({
      phone: normalized,
      amount: Math.round(amount),
      accountRef: (invoiceNumber || 'INV').slice(0, 12),   // Daraja hard limit
      description: 'Invoice',                              // 13-char limit
      callbackUrl,
    });

      // Daraja returns ResponseCode "0" on success
    if (result.ResponseCode !== '0') {
      return res.status(502).json({
        error: result.ResponseDescription || 'Safaricom rejected the request',
      });
    }

    // Save the pending row so the callback can find and update it
    const { error: dbError } = await supabase.from('mpesa_payments').insert({
      checkout_request_id: result.CheckoutRequestID,
      merchant_request_id: result.MerchantRequestID,
      invoice_number: invoiceNumber || 'INV',
      client_name: clientName || 'Client',
      client_phone: normalized,
      amount: Math.round(amount),
      status: 'pending',
    });

    if (dbError) {
      console.error('[mpesa-push] db insert failed:', dbError);
      // Don't fail the request — the STK Push already went out
    }

    return res.json({
      ok: true,
      checkoutId: result.CheckoutRequestID,
      message: 'PIN prompt sent to the client\'s phone',
    });
  } catch (err) {
    console.error('[mpesa-push]', err);
    return res.status(500).json({ error: err.message });
  }
}