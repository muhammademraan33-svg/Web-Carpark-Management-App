const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const accounts = await db.prepare('SELECT * FROM account_customers WHERE carpark_id = ? AND active = 1 ORDER BY company_name').all(req.session.carparkId || 1);
    res.json(accounts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const account = await db.prepare('SELECT * FROM account_customers WHERE id = ?').get(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const invoices = await db.prepare(`SELECT * FROM invoices WHERE account_customer_id = ? AND void = 0 ORDER BY date_in DESC LIMIT 50`).all(req.params.id);
    res.json({ ...account, invoices });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/statement', requireAuth, async (req, res) => {
  try {
    const { month, year } = req.query;
    const carparkId = req.session.carparkId || 1;
    const account = await db.prepare('SELECT * FROM account_customers WHERE id = ? AND carpark_id = ?').get(req.params.id, carparkId);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const m = String(month || new Date().getMonth() + 1).padStart(2, '0');
    const y = year || new Date().getFullYear();
    const startDate = `${y}-${m}-01`;
    const endDate = new Date(y, parseInt(m), 0).toISOString().split('T')[0];
    const invoices = await db.prepare(`SELECT * FROM invoices WHERE account_customer_id = ? AND void = 0 AND DATE(date_in) >= ? AND DATE(date_in) <= ? ORDER BY date_in ASC`).all(req.params.id, startDate, endDate);
    const total = invoices.reduce((sum, inv) => sum + (inv.payment_amount || 0), 0);
    res.json({ account, invoices, total, month: m, year: y, startDate, endDate });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const { company_name, contact_name, phone, email, billing_email, payment_link, discount_percent, notes } = req.body;
    const result = await db.prepare(`INSERT INTO account_customers (company_name, contact_name, phone, email, billing_email, payment_link, discount_percent, notes, carpark_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(company_name, contact_name, phone, email, billing_email, payment_link || '', discount_percent || 0, notes, carparkId);
    const account = await db.prepare('SELECT * FROM account_customers WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(account);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { company_name, contact_name, phone, email, billing_email, payment_link, discount_percent, credit_balance, notes } = req.body;
    await db.prepare(`UPDATE account_customers SET company_name=?, contact_name=?, phone=?, email=?, billing_email=?, payment_link=?, discount_percent=?, credit_balance=?, notes=? WHERE id = ?`)
      .run(company_name, contact_name, phone, email, billing_email, payment_link || '', discount_percent || 0, credit_balance || 0, notes, req.params.id);
    const account = await db.prepare('SELECT * FROM account_customers WHERE id = ?').get(req.params.id);
    res.json(account);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await db.prepare('UPDATE account_customers SET active = 0 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
