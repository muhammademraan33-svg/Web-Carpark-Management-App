const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { businessDateYmd } = require('../utils/businessDate');
const { INV_DAY, PAY_DAY, MONTH_PAID_BY_INVOICE, MONTH_PAID_UNALLOCATED } = require('../utils/accountPayments');
const router = express.Router();

async function invoicePaidAmount(invoiceId) {
  const row = await db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS paid FROM account_payments WHERE invoice_id = ?`
  ).get(invoiceId);
  return Math.round((parseFloat(row?.paid) || 0) * 100) / 100;
}

async function enrichInvoiceWithPayments(inv) {
  const billed = parseFloat(inv.total_price || 0) || 0;
  const paid = await invoicePaidAmount(inv.id);
  const outstanding = Math.round(Math.max(0, billed - paid) * 100) / 100;
  return {
    ...inv,
    amount_paid: paid,
    amount_outstanding: outstanding,
    payment_status: billed <= 0 ? '—' : (outstanding <= 0.01 ? 'Paid' : (paid > 0 ? 'Partial' : 'Outstanding')),
  };
}

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
        (SELECT COALESCE(SUM(COALESCE(i.total_price,0)),0) FROM invoices i
         WHERE i.account_customer_id = a.id AND i.carpark_id = a.carpark_id AND i.void = 0
         AND substr(trim(COALESCE(i.date_in,'')),1,10) >= ? AND substr(trim(COALESCE(i.date_in,'')),1,10) <= ?) AS month_billed,
        ${MONTH_PAID_BY_INVOICE} + ${MONTH_PAID_UNALLOCATED} AS month_paid,
        (SELECT COALESCE(SUM(COALESCE(i.total_price,0)),0) FROM invoices i
         WHERE i.account_customer_id = a.id AND i.carpark_id = a.carpark_id AND i.void = 0) AS lifetime_billed,
        (SELECT COALESCE(SUM(p.amount),0) FROM account_payments p
         WHERE p.account_customer_id = a.id AND p.carpark_id = a.carpark_id) AS lifetime_paid
      FROM account_customers a
      WHERE a.carpark_id = ? AND a.active = 1 ORDER BY a.company_name
    `).all(monthStart, monthEnd, monthStart, monthEnd, monthStart, monthEnd, carparkId);

    const rows = accounts.map((a) => {
      const billed = parseFloat(a.month_billed) || 0;
      const paid = parseFloat(a.month_paid) || 0;
      const out = Math.round((billed - paid) * 100) / 100;
      const lifeBilled = parseFloat(a.lifetime_billed) || 0;
      const lifePaid = parseFloat(a.lifetime_paid) || 0;
      const balanceOut = Math.round((lifeBilled - lifePaid) * 100) / 100;
      return {
        ...a,
        month_outstanding: out,
        month_payment_status: billed <= 0 ? '—' : (out <= 0.01 ? 'Paid' : 'Outstanding'),
        balance_outstanding: balanceOut,
        balance_payment_status: lifeBilled <= 0 ? '—' : (balanceOut <= 0.01 ? 'Paid' : 'Outstanding'),
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

/** Invoices with an outstanding balance (for payment allocation dropdown). */
router.get('/:id/outstanding-invoices', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const accountId = req.params.id;
    const account = await db.prepare('SELECT id FROM account_customers WHERE id = ? AND carpark_id = ?').get(accountId, carparkId);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const invoices = await db.prepare(`
      SELECT i.id, i.invoice_number, i.date_in, i.return_date, i.first_name, i.last_name, i.rego,
             COALESCE(i.total_price, 0) AS total_price
      FROM invoices i
      WHERE i.account_customer_id = ? AND i.carpark_id = ? AND i.void = 0
      ORDER BY i.date_in ASC, i.id ASC
    `).all(accountId, carparkId);

    const enriched = [];
    for (const inv of invoices) {
      const row = await enrichInvoiceWithPayments(inv);
      if (row.amount_outstanding > 0.01) enriched.push(row);
    }
    res.json({ invoices: enriched });
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

    const rawInvoices = await db.prepare(`
      SELECT * FROM invoices
      WHERE account_customer_id = ? AND void = 0
        AND substr(trim(COALESCE(date_in,'')),1,10) >= ?
        AND substr(trim(COALESCE(date_in,'')),1,10) <= ?
      ORDER BY date_in ASC
    `).all(req.params.id, startDate, endDate);

    const invoices = [];
    for (const inv of rawInvoices) {
      invoices.push(await enrichInvoiceWithPayments(inv));
    }

    const total = invoices.reduce((sum, inv) => sum + (parseFloat(inv.total_price || 0) || 0), 0);
    const paid = invoices.reduce((sum, inv) => sum + (parseFloat(inv.amount_paid || 0) || 0), 0);
    const outstanding = Math.round(Math.max(0, total - paid) * 100) / 100;

    // Payments allocated to invoices in this statement month (any payment date).
    const payments = await db.prepare(`
      SELECT p.*, i.invoice_number, i.date_in AS invoice_date_in,
             i.first_name AS inv_first_name, i.last_name AS inv_last_name, i.rego AS inv_rego
      FROM account_payments p
      LEFT JOIN invoices i ON i.id = p.invoice_id
      WHERE p.carpark_id = ? AND p.account_customer_id = ?
        AND (
          (p.invoice_id IS NOT NULL AND substr(trim(COALESCE(i.date_in,'')),1,10) >= ? AND substr(trim(COALESCE(i.date_in,'')),1,10) <= ?)
          OR (p.invoice_id IS NULL AND ${PAY_DAY} >= ? AND ${PAY_DAY} <= ?)
        )
      ORDER BY p.payment_date DESC, p.id DESC
    `).all(carparkId, req.params.id, startDate, endDate, startDate, endDate);

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
      SELECT p.*, i.invoice_number
      FROM account_payments p
      LEFT JOIN invoices i ON i.id = p.invoice_id
      WHERE p.carpark_id = ? AND p.account_customer_id = ?
        AND ${PAY_DAY} >= ? AND ${PAY_DAY} <= ?
      ORDER BY p.payment_date DESC, p.id DESC
    `).all(carparkId, req.params.id, fromDate, toDate);
    res.json({ payments, fromDate, toDate });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/payments', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const accountId = req.params.id;
    const { payment_date, amount, payment_method, transaction_reference, notes, invoice_id } = req.body || {};
    const amt = parseFloat(amount);
    if (!payment_date) return res.status(400).json({ error: 'payment_date is required' });
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'amount must be > 0' });

    const invId = invoice_id ? parseInt(invoice_id, 10) : null;
    if (!invId) return res.status(400).json({ error: 'Select an invoice to allocate this payment to' });

    const invoice = await db.prepare(`
      SELECT id, total_price FROM invoices
      WHERE id = ? AND account_customer_id = ? AND carpark_id = ? AND void = 0
    `).get(invId, accountId, carparkId);
    if (!invoice) return res.status(400).json({ error: 'Invoice not found for this account' });

    const alreadyPaid = await invoicePaidAmount(invId);
    const billed = parseFloat(invoice.total_price || 0) || 0;
    const remaining = Math.round((billed - alreadyPaid) * 100) / 100;
    if (remaining <= 0.01) return res.status(400).json({ error: 'This invoice is already fully paid' });
    if (amt > remaining + 0.01) {
      return res.status(400).json({ error: `Amount exceeds invoice outstanding (${remaining.toFixed(2)})` });
    }

    const result = await db.prepare(`
      INSERT INTO account_payments (carpark_id, account_customer_id, invoice_id, payment_date, amount, payment_method, transaction_reference, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(carparkId, accountId, invId, payment_date, amt, payment_method || null, transaction_reference || null, notes || null);
    res.status(201).json({ success: true, id: result.lastInsertRowid, invoice_id: invId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/payments/:paymentId', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const accountId = req.params.id;
    const paymentId = req.params.paymentId;
    const row = await db.prepare(`
      SELECT id FROM account_payments
      WHERE id = ? AND carpark_id = ? AND account_customer_id = ?
    `).get(paymentId, carparkId, accountId);
    if (!row) return res.status(404).json({ error: 'Payment not found' });
    await db.prepare('DELETE FROM account_payments WHERE id = ?').run(paymentId);
    res.json({ success: true });
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
