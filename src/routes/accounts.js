const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { businessDateYmd } = require('../utils/businessDate');
const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const today = businessDateYmd();
    const y = parseInt(today.slice(0, 4), 10);
    const mo = parseInt(today.slice(5, 7), 10);
    const monthStart = `${today.slice(0, 7)}-01`;
    const last = new Date(y, mo, 0);
    const monthEnd = `${y}-${String(mo).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;

    const accounts = await db.prepare(`
      SELECT a.*,
        (SELECT COALESCE(SUM(COALESCE(i.payment_amount,0)+COALESCE(i.payment_amount_2,0)),0) FROM invoices i
         WHERE i.account_customer_id = a.id AND i.carpark_id = a.carpark_id AND i.void = 0
         AND substr(trim(COALESCE(i.date_in,'')),1,10) >= ? AND substr(trim(COALESCE(i.date_in,'')),1,10) <= ?) AS month_billed,
        (SELECT COALESCE(SUM(p.amount),0) FROM account_payments p
         WHERE p.account_customer_id = a.id AND p.carpark_id = a.carpark_id
         AND substr(trim(COALESCE(p.payment_date,'')),1,10) >= ? AND substr(trim(COALESCE(p.payment_date,'')),1,10) <= ?) AS month_paid
      FROM account_customers a
      WHERE a.carpark_id = ? AND a.active = 1 ORDER BY a.company_name
    `).all(monthStart, monthEnd, monthStart, monthEnd, carparkId);

    const rows = accounts.map((a) => {
      const billed = parseFloat(a.month_billed) || 0;
      const paid = parseFloat(a.month_paid) || 0;
      const out = Math.round((billed - paid) * 100) / 100;
      return {
        ...a,
        month_outstanding: out,
        month_payment_status: billed <= 0 ? '—' : (out <= 0.01 ? 'Paid' : 'Outstanding'),
      };
    });
    res.json(rows);
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
    const today = businessDateYmd();
    const m = String(month || parseInt(today.slice(5, 7), 10)).padStart(2, '0');
    const y = parseInt(year || today.slice(0, 4), 10);
    const startDate = `${y}-${m}-01`;
    const endDate = `${y}-${m}-${String(new Date(y, parseInt(m, 10), 0).getDate()).padStart(2, '0')}`;
    const invoices = await db.prepare(`
      SELECT * FROM invoices
      WHERE account_customer_id = ? AND void = 0
        AND substr(trim(COALESCE(date_in,'')),1,10) >= ?
        AND substr(trim(COALESCE(date_in,'')),1,10) <= ?
      ORDER BY date_in ASC
    `).all(req.params.id, startDate, endDate);
    const total = invoices.reduce((sum, inv) => sum + (parseFloat(inv.total_price || 0) || 0), 0);
    const payments = await db.prepare(`
      SELECT * FROM account_payments
      WHERE carpark_id = ? AND account_customer_id = ?
        AND substr(trim(COALESCE(payment_date,'')),1,10) >= ?
        AND substr(trim(COALESCE(payment_date,'')),1,10) <= ?
      ORDER BY payment_date DESC, id DESC
    `).all(carparkId, req.params.id, startDate, endDate);
    const paid = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const outstanding = Math.max(0, (total || 0) - paid);
    res.json({ account, invoices, total, month: m, year: y, startDate, endDate, payments, paid, outstanding });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/payments', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const { from, to } = req.query;
    const today = businessDateYmd();
    const fromDate = from || `${today.slice(0, 7)}-01`;
    const toDate   = to || today;
    const payments = await db.prepare(`
      SELECT * FROM account_payments
      WHERE carpark_id = ? AND account_customer_id = ?
        AND substr(trim(COALESCE(payment_date,'')),1,10) >= ?
        AND substr(trim(COALESCE(payment_date,'')),1,10) <= ?
      ORDER BY payment_date DESC, id DESC
    `).all(carparkId, req.params.id, fromDate, toDate);
    res.json({ payments, fromDate, toDate });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/payments', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const { payment_date, amount, payment_method, transaction_reference, notes } = req.body || {};
    const amt = parseFloat(amount);
    if (!payment_date) return res.status(400).json({ error: 'payment_date is required' });
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'amount must be > 0' });
    await db.prepare(`
      INSERT INTO account_payments (carpark_id, account_customer_id, payment_date, amount, payment_method, transaction_reference, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(carparkId, req.params.id, payment_date, amt, payment_method || null, transaction_reference || null, notes || null);
    res.status(201).json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const { company_name, contact_name, phone, email, billing_email, payment_link, discount_percent, notes, rego_1, rego_2 } = req.body;
    const result = await db.prepare(`INSERT INTO account_customers (company_name, contact_name, phone, email, billing_email, payment_link, discount_percent, notes, rego_1, rego_2, carpark_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(company_name, contact_name, phone, email, billing_email, payment_link || '', discount_percent || 0, notes, rego_1 || null, rego_2 || null, carparkId);
    const account = await db.prepare('SELECT * FROM account_customers WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(account);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { company_name, contact_name, phone, email, billing_email, payment_link, discount_percent, credit_balance, notes, rego_1, rego_2 } = req.body;
    await db.prepare(`UPDATE account_customers SET company_name=?, contact_name=?, phone=?, email=?, billing_email=?, payment_link=?, discount_percent=?, credit_balance=?, notes=?, rego_1=?, rego_2=? WHERE id = ?`)
      .run(company_name, contact_name, phone, email, billing_email, payment_link || '', discount_percent || 0, credit_balance || 0, notes, rego_1 || null, rego_2 || null, req.params.id);
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
