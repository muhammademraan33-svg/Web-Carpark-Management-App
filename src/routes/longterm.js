const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { parseKeyNumber, releaseKey, assignKeyToLongTerm } = require('../utils/keyBoxSync');
const router = express.Router();

function normalizedMoney(val) {
  if (val == null || val === '') return null;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : null;
}

function assertPricingValid(rate, contractAmount) {
  const r = normalizedMoney(rate) || 0;
  const c = normalizedMoney(contractAmount) || 0;
  if (r <= 0 && c <= 0) {
    return 'Set either Monthly Rate > 0 or Contract term total > 0';
  }
  return null;
}

function ymdToday() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetweenYmd(fromYmd, toYmd) {
  if (!fromYmd || !toYmd) return null;
  const a = new Date(`${fromYmd}T00:00:00Z`);
  const b = new Date(`${toYmd}T00:00:00Z`);
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function withRenewalStatus(row, todayYmd) {
  const expiry = row.expiry_date ? String(row.expiry_date).slice(0, 10) : null;
  if (!expiry) {
    return { ...row, expiry_date: null, renewal_status: 'no_expiry', days_to_expiry: null };
  }
  const days = daysBetweenYmd(todayYmd, expiry);
  let renewal = 'active';
  if (days < 0) renewal = 'expired';
  else if (days <= 30) renewal = 'due_soon';
  return { ...row, expiry_date: expiry, renewal_status: renewal, days_to_expiry: days };
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const today = ymdToday();
    const customers = await db.prepare(`
      SELECT * FROM longterm_customers WHERE carpark_id = ? AND active = 1
      ORDER BY CAST(REPLACE(lt_number, 'LT', '') AS INTEGER)
    `).all(carparkId);
    res.json(customers.map(c => withRenewalStatus(c, today)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/next-number', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    // Pick the smallest missing LT number among ACTIVE customers.
    // This ensures:
    // - Empty list => LT1
    // - If LT5 is deleted from the middle => next add uses LT5 again
    // - Easy + safe: no mass-renumbering of existing records required
    const rows = await db.prepare(`
      SELECT lt_number
      FROM longterm_customers
      WHERE carpark_id = ? AND active = 1
      ORDER BY CAST(REPLACE(lt_number, 'LT', '') AS INTEGER) ASC
    `).all(carparkId);

    const used = new Set();
    for (const r of rows) {
      const n = parseInt(String(r.lt_number).replace('LT', ''), 10);
      if (!Number.isNaN(n) && n > 0) used.add(n);
    }

    let next = 1;
    while (used.has(next)) next += 1;
    res.json({ ltNumber: `LT${next}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const customer = await db.prepare('SELECT * FROM longterm_customers WHERE id = ?').get(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Not found' });
    const kb = await db.prepare(`
      SELECT key_number, status, holder_type
      FROM key_box
      WHERE carpark_id = ? AND longterm_customer_id = ?
      LIMIT 1
    `).get(req.session.carparkId || 1, req.params.id);
    res.json({
      ...withRenewalStatus(customer, ymdToday()),
      key_number: kb ? kb.key_number : null,
      key_in_yard: !!(kb && kb.status === 'in_use')
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/keybox', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const ltId = parseInt(req.params.id, 10);
    const { action, key_number } = req.body || {};
    const lt = await db.prepare('SELECT id, lt_number, name, active FROM longterm_customers WHERE id = ? AND carpark_id = ?').get(ltId, carparkId);
    if (!lt || lt.active !== 1) return res.status(404).json({ error: 'Long-term customer not found' });

    if (action === 'release') {
      const cur = await db.prepare(`SELECT key_number FROM key_box WHERE carpark_id = ? AND longterm_customer_id = ? AND status = 'in_use' LIMIT 1`).get(carparkId, ltId);
      if (cur && cur.key_number != null) await releaseKey(db, carparkId, cur.key_number);
      return res.json({ success: true, key_number: null, key_in_yard: false });
    }

    if (action !== 'assign') return res.status(400).json({ error: 'Invalid action' });
    let kn = parseKeyNumber(key_number);
    if (kn == null) {
      const fallback = parseInt(String(lt.lt_number || '').replace(/[^0-9]/g, ''), 10);
      if (!Number.isNaN(fallback) && fallback > 0) kn = fallback;
    }
    if (kn == null) return res.status(400).json({ error: 'Key number is required' });

    const conflict = await db.prepare(`
      SELECT k.*, i.invoice_number, lt.lt_number
      FROM key_box k
      LEFT JOIN invoices i ON k.invoice_id = i.id AND i.void = 0
      LEFT JOIN longterm_customers lt ON k.longterm_customer_id = lt.id
      WHERE k.carpark_id = ? AND k.key_number = ? AND k.status = 'in_use'
      LIMIT 1
    `).get(carparkId, kn);
    if (conflict) {
      const sameLt = conflict.longterm_customer_id && Number(conflict.longterm_customer_id) === ltId;
      if (!sameLt) {
        const owner = conflict.invoice_id ? `Invoice #${conflict.invoice_number || conflict.invoice_id}` : `Long-term ${conflict.lt_number || ''}`.trim();
        return res.status(400).json({ error: `Key ${kn} is already in use by ${owner}` });
      }
    }

    const current = await db.prepare(`SELECT key_number FROM key_box WHERE carpark_id = ? AND longterm_customer_id = ? AND status = 'in_use' LIMIT 1`).get(carparkId, ltId);
    if (current && Number(current.key_number) !== kn) await releaseKey(db, carparkId, current.key_number);
    await assignKeyToLongTerm(db, carparkId, kn, ltId);
    res.json({ success: true, key_number: kn, key_in_yard: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const { lt_number, name, rego_1, rego_2, phone, email, rate, rate_period, expiry_date, notes, contract_amount, payment_status } = req.body;
    const pricingErr = assertPricingValid(rate, contract_amount);
    if (pricingErr) return res.status(400).json({ error: pricingErr });
    const existing = await db.prepare('SELECT id, active FROM longterm_customers WHERE lt_number = ? AND carpark_id = ?').get(lt_number, carparkId);

    // If the LT exists but is inactive, reuse the same LT# by reactivating it.
    // This is required because `lt_number` is UNIQUE in the DB schema.
    if (existing) {
      if (existing.active === 1) return res.status(400).json({ error: 'LT number already exists' });

      await db.prepare(`
        UPDATE longterm_customers
        SET active = 1, name=?, rego_1=?, rego_2=?, phone=?, email=?, rate=?, rate_period=?, expiry_date=?, notes=?,
            contract_amount=?, payment_status=?
        WHERE id = ?
      `).run(
        name, rego_1, rego_2, phone, email,
        rate || 0, rate_period || 'monthly', expiry_date || null, notes,
        contract_amount != null && contract_amount !== '' ? parseFloat(contract_amount) : null,
        payment_status || 'Unpaid',
        existing.id
      );

      const customer = await db.prepare('SELECT * FROM longterm_customers WHERE id = ?').get(existing.id);
      return res.json(customer);
    }

    const result = await db.prepare(`
      INSERT INTO longterm_customers
        (lt_number, name, rego_1, rego_2, phone, email, rate, rate_period, expiry_date, notes, carpark_id, contract_amount, payment_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      lt_number, name, rego_1, rego_2, phone, email, rate || 0, rate_period || 'monthly', expiry_date || null, notes, carparkId,
      contract_amount != null && contract_amount !== '' ? parseFloat(contract_amount) : null,
      payment_status || 'Unpaid'
    );

    const customer = await db.prepare('SELECT * FROM longterm_customers WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(customer);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { name, rego_1, rego_2, phone, email, rate, rate_period, expiry_date, notes, contract_amount, payment_status } = req.body;
    const pricingErr = assertPricingValid(rate, contract_amount);
    if (pricingErr) return res.status(400).json({ error: pricingErr });
    await db.prepare(`UPDATE longterm_customers SET name=?, rego_1=?, rego_2=?, phone=?, email=?, rate=?, rate_period=?, expiry_date=?, notes=?, contract_amount=?, payment_status=? WHERE id = ?`)
      .run(
        name, rego_1, rego_2, phone, email, rate || 0, rate_period || 'monthly', expiry_date || null, notes,
        contract_amount != null && contract_amount !== '' ? parseFloat(contract_amount) : null,
        payment_status || 'Unpaid',
        req.params.id
      );
    const customer = await db.prepare('SELECT * FROM longterm_customers WHERE id = ?').get(req.params.id);
    res.json(customer);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const cur = await db.prepare(`SELECT key_number FROM key_box WHERE carpark_id = ? AND longterm_customer_id = ? AND status = 'in_use' LIMIT 1`).get(carparkId, req.params.id);
    if (cur && cur.key_number != null) await releaseKey(db, carparkId, cur.key_number);
    // Hard delete so `lt_number` (UNIQUE) is actually free to reuse.
    // Soft-delete would keep the lt_number occupied and block "next" numbering.
    await db.prepare('DELETE FROM longterm_customers WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
