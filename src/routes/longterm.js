const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET /api/longterm
router.get('/', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const customers = db.prepare(`
    SELECT * FROM longterm_customers WHERE carpark_id = ? AND active = 1
    ORDER BY CAST(REPLACE(lt_number, 'LT', '') AS INTEGER)
  `).all(carparkId);
  res.json(customers);
});

// GET /api/longterm/next-number
router.get('/next-number', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const result = db.prepare(`
    SELECT lt_number FROM longterm_customers WHERE carpark_id = ?
    ORDER BY CAST(REPLACE(lt_number, 'LT', '') AS INTEGER) DESC LIMIT 1
  `).get(carparkId);
  
  let nextNum = 1;
  if (result) {
    const num = parseInt(result.lt_number.replace('LT', ''));
    nextNum = num + 1;
  }
  res.json({ ltNumber: `LT${nextNum}` });
});

// GET /api/longterm/:id
router.get('/:id', requireAuth, (req, res) => {
  const customer = db.prepare('SELECT * FROM longterm_customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  res.json(customer);
});

// POST /api/longterm
router.post('/', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { lt_number, name, rego_1, rego_2, phone, email, rate, rate_period, expiry_date, notes } = req.body;
  
  const existing = db.prepare('SELECT id FROM longterm_customers WHERE lt_number = ? AND carpark_id = ?').get(lt_number, carparkId);
  if (existing) return res.status(400).json({ error: 'LT number already exists' });

  const result = db.prepare(`
    INSERT INTO longterm_customers (lt_number, name, rego_1, rego_2, phone, email, rate, rate_period, expiry_date, notes, carpark_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(lt_number, name, rego_1, rego_2, phone, email, rate || 0, rate_period || 'monthly', expiry_date || null, notes, carparkId);
  
  const customer = db.prepare('SELECT * FROM longterm_customers WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(customer);
});

// PUT /api/longterm/:id
router.put('/:id', requireAuth, (req, res) => {
  const { name, rego_1, rego_2, phone, email, rate, rate_period, expiry_date, notes } = req.body;
  db.prepare(`
    UPDATE longterm_customers SET name=?, rego_1=?, rego_2=?, phone=?, email=?, rate=?, rate_period=?, expiry_date=?, notes=?
    WHERE id = ?
  `).run(name, rego_1, rego_2, phone, email, rate || 0, rate_period || 'monthly', expiry_date || null, notes, req.params.id);
  const customer = db.prepare('SELECT * FROM longterm_customers WHERE id = ?').get(req.params.id);
  res.json(customer);
});

// DELETE /api/longterm/:id (deactivate)
router.delete('/:id', requireAuth, (req, res) => {
  db.prepare('UPDATE longterm_customers SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
