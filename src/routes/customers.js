const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET /api/customers - search customers
router.get('/', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { search } = req.query;
  let query = 'SELECT * FROM customers WHERE carpark_id = ? AND active = 1';
  const params = [carparkId];
  if (search) {
    query += ` AND (last_name LIKE ? OR first_name LIKE ? OR phone LIKE ? OR email LIKE ?)`;
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }
  query += ' ORDER BY last_name, first_name LIMIT 50';
  const customers = db.prepare(query).all(...params);
  res.json(customers);
});

// GET /api/customers/:id
router.get('/:id', requireAuth, (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND active = 1').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  
  // Get recent invoices
  const invoices = db.prepare('SELECT * FROM invoices WHERE customer_id = ? ORDER BY created_at DESC LIMIT 10').all(req.params.id);
  res.json({ ...customer, invoices });
});

// POST /api/customers
router.post('/', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { first_name, last_name, phone, email, notes, alert_message } = req.body;
  const result = db.prepare(`
    INSERT INTO customers (first_name, last_name, phone, email, notes, alert_message, carpark_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(first_name, last_name, phone, email, notes, alert_message, carparkId);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(customer);
});

// PUT /api/customers/:id
router.put('/:id', requireAuth, (req, res) => {
  const { first_name, last_name, phone, email, notes, alert_message } = req.body;
  db.prepare(`
    UPDATE customers SET first_name = ?, last_name = ?, phone = ?, email = ?, notes = ?, alert_message = ?
    WHERE id = ?
  `).run(first_name, last_name, phone, email, notes, alert_message, req.params.id);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  res.json(customer);
});

module.exports = router;
