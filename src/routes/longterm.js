const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const customers = await db.prepare(`
      SELECT * FROM longterm_customers WHERE carpark_id = ? AND active = 1
      ORDER BY CAST(REPLACE(lt_number, 'LT', '') AS INTEGER)
    `).all(carparkId);
    res.json(customers);
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
    res.json(customer);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const { lt_number, name, rego_1, rego_2, phone, email, rate, rate_period, expiry_date, notes } = req.body;
    const existing = await db.prepare('SELECT id, active FROM longterm_customers WHERE lt_number = ? AND carpark_id = ?').get(lt_number, carparkId);

    // If the LT exists but is inactive, reuse the same LT# by reactivating it.
    // This is required because `lt_number` is UNIQUE in the DB schema.
    if (existing) {
      if (existing.active === 1) return res.status(400).json({ error: 'LT number already exists' });

      await db.prepare(`
        UPDATE longterm_customers
        SET active = 1, name=?, rego_1=?, rego_2=?, phone=?, email=?, rate=?, rate_period=?, expiry_date=?, notes=?
        WHERE id = ?
      `).run(
        name, rego_1, rego_2, phone, email,
        rate || 0, rate_period || 'monthly', expiry_date || null, notes, existing.id
      );

      const customer = await db.prepare('SELECT * FROM longterm_customers WHERE id = ?').get(existing.id);
      return res.json(customer);
    }

    const result = await db.prepare(`
      INSERT INTO longterm_customers
        (lt_number, name, rego_1, rego_2, phone, email, rate, rate_period, expiry_date, notes, carpark_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(lt_number, name, rego_1, rego_2, phone, email, rate || 0, rate_period || 'monthly', expiry_date || null, notes, carparkId);

    const customer = await db.prepare('SELECT * FROM longterm_customers WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(customer);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { name, rego_1, rego_2, phone, email, rate, rate_period, expiry_date, notes } = req.body;
    await db.prepare(`UPDATE longterm_customers SET name=?, rego_1=?, rego_2=?, phone=?, email=?, rate=?, rate_period=?, expiry_date=?, notes=? WHERE id = ?`)
      .run(name, rego_1, rego_2, phone, email, rate || 0, rate_period || 'monthly', expiry_date || null, notes, req.params.id);
    const customer = await db.prepare('SELECT * FROM longterm_customers WHERE id = ?').get(req.params.id);
    res.json(customer);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    // Hard delete so `lt_number` (UNIQUE) is actually free to reuse.
    // Soft-delete would keep the lt_number occupied and block "next" numbering.
    await db.prepare('DELETE FROM longterm_customers WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
