// GET /api/mpesa-status?id=ws_CO_...
// Returns: { status: "pending" | "paid" | "failed", receipt?: "..." }

import { supabase } from '../lib/db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') return res.status(405).end();

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });

  const { data, error } = await supabase
    .from('mpesa_payments')
    .select('status, mpesa_receipt')
    .eq('checkout_request_id', id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ status: 'not_found' });

  return res.json({
    status: data.status,
    receipt: data.mpesa_receipt || null,
  });
}