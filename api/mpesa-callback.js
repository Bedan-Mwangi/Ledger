// POST /api/mpesa-callback
// Safaricom calls this after the client enters (or cancels) their M-Pesa PIN.
// Body shape: { Body: { stkCallback: { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata? } } }

import { supabase } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Log everything so we can debug from the Vercel logs
  console.log('[mpesa-callback] received:', JSON.stringify(req.body));

  const callback = req.body?.Body?.stkCallback;
  if (!callback) {
    console.error('[mpesa-callback] missing Body.stkCallback');
    // Still return success — Safaricom retries if we return non-200
    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }

  const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = callback;

  if (!CheckoutRequestID) {
    console.error('[mpesa-callback] missing CheckoutRequestID');
    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }

  const paid = ResultCode === 0;

  // Extract M-Pesa receipt number if paid
  let receipt = null;
  if (paid && CallbackMetadata?.Item) {
    const items = Object.fromEntries(
      CallbackMetadata.Item.map(i => [i.Name, i.Value])
    );
    receipt = items.MpesaReceiptNumber || null;
  }

  // Update the row we created in /api/mpesa-push
  const { error } = await supabase
    .from('mpesa_payments')
    .update({
      status: paid ? 'paid' : 'failed',
      result_code: ResultCode,
      result_desc: ResultDesc,
      mpesa_receipt: receipt,
    })
    .eq('checkout_request_id', CheckoutRequestID);

  if (error) {
    console.error('[mpesa-callback] db update failed:', error);
    // Still return 200 — otherwise Safaricom retries and we spam errors
  } else {
    console.log(`[mpesa-callback] updated ${CheckoutRequestID} → ${paid ? 'paid' : 'failed'}`);
  }

  // Always respond with this exact shape — Safaricom requires it
  return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
}