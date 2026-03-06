const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET /api/accounts
router.get('/', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const accounts = db.prepare('SELECT * FROM account_customers WHERE carpark_id = ? AND active = 1 ORDER BY company_name').all(carparkId);
  res.json(accounts);
});

// GET /api/accounts/:id
router.get('/:id', requireAuth, (req, res) => {
  const account = db.prepare('SELECT * FROM account_customers WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  
  // Get recent invoices for this account
  const invoices = db.prepare(`
    SELECT * FROM invoices WHERE account_customer_id = ? AND void = 0
    ORDER BY date_in DESC LIMIT 50
  `).all(req.params.id);
  
  res.json({ ...account, invoices });
});

// GET /api/accounts/:id/statement - Get monthly statement
router.get('/:id/statement', requireAuth, (req, res) => {
  const { month, year } = req.query;
  const carparkId = req.session.carparkId || 1;
  
  const account = db.prepare('SELECT * FROM account_customers WHERE id = ? AND carpark_id = ?').get(req.params.id, carparkId);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  const m = String(month || new Date().getMonth() + 1).padStart(2, '0');
  const y = year || new Date().getFullYear();
  const startDate = `${y}-${m}-01`;
  const endDate = new Date(y, parseInt(m), 0).toISOString().split('T')[0];

  const invoices = db.prepare(`
    SELECT * FROM invoices 
    WHERE account_customer_id = ? AND void = 0
    AND DATE(date_in) >= ? AND DATE(date_in) <= ?
    ORDER BY date_in ASC
  `).all(req.params.id, startDate, endDate);

  const total = invoices.reduce((sum, inv) => sum + (inv.payment_amount || 0), 0);

  res.json({
    account,
    invoices,
    total,
    month: m,
    year: y,
    startDate,
    endDate
  });
});

// POST /api/accounts
router.post('/', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { company_name, contact_name, phone, email, billing_email, payment_link, discount_percent, notes } = req.body;
  const result = db.prepare(`
    INSERT INTO account_customers (company_name, contact_name, phone, email, billing_email, payment_link, discount_percent, notes, carpark_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(company_name, contact_name, phone, email, billing_email, payment_link || '', discount_percent || 0, notes, carparkId);
  const account = db.prepare('SELECT * FROM account_customers WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(account);
});

// PUT /api/accounts/:id
router.put('/:id', requireAuth, (req, res) => {
  const { company_name, contact_name, phone, email, billing_email, payment_link, discount_percent, credit_balance, notes } = req.body;
  db.prepare(`
    UPDATE account_customers SET company_name=?, contact_name=?, phone=?, email=?, billing_email=?, payment_link=?, discount_percent=?, credit_balance=?, notes=?
    WHERE id = ?
  `).run(company_name, contact_name, phone, email, billing_email, payment_link || '', discount_percent || 0, credit_balance || 0, notes, req.params.id);
  const account = db.prepare('SELECT * FROM account_customers WHERE id = ?').get(req.params.id);
  res.json(account);
});

// DELETE /api/accounts/:id (deactivate)
router.delete('/:id', requireAuth, (req, res) => {
  db.prepare('UPDATE account_customers SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
