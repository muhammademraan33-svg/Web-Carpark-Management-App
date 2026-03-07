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
    const result = await db.prepare(`
      SELECT lt_number FROM longterm_customers WHERE carpark_id = ?
      ORDER BY CAST(REPLACE(lt_number, 'LT', '') AS INTEGER) DESC LIMIT 1
    `).get(carparkId);
    const nextNum = result ? parseInt(result.lt_number.replace('LT', '')) + 1 : 1;
    res.json({ ltNumber: `LT${nextNum}` });
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
    const existing = await db.prepare('SELECT id FROM longterm_customers WHERE lt_number = ? AND carpark_id = ?').get(lt_number, carparkId);
    if (existing) return res.status(400).json({ error: 'LT number already exists' });
    const result = await db.prepare(`INSERT INTO longterm_customers (lt_number, name, rego_1, rego_2, phone, email, rate, rate_period, expiry_date, notes, carpark_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(lt_number, name, rego_1, rego_2, phone, email, rate || 0, rate_period || 'monthly', expiry_date || null, notes, carparkId);
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
    await db.prepare('UPDATE longterm_customers SET active = 0 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
