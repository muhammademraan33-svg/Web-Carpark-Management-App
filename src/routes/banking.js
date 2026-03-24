const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const { from, to } = req.query;
    const today = new Date().toISOString().split('T')[0];
    const fromDate = from || new Date(new Date().setDate(1)).toISOString().split('T')[0];
    const toDate = to || today;
    const records = await db.prepare(`SELECT b.*, u.name as staff_name FROM banking b LEFT JOIN users u ON b.staff_id = u.id WHERE b.carpark_id = ? AND b.date >= ? AND b.date <= ? ORDER BY b.date DESC`).all(carparkId, fromDate, toDate);
    const summary = await db.prepare(`SELECT COALESCE(SUM(eftpos_total),0) as eftpos, COALESCE(SUM(cash_total),0) as cash, COALESCE(SUM(account_total),0) as account, COALESCE(SUM(other_total),0) as other FROM banking WHERE carpark_id = ? AND date >= ? AND date <= ?`).get(carparkId, fromDate, toDate);
    res.json({ records, summary, fromDate, toDate });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const { date, eftpos_total, cash_total, account_total, other_total, notes } = req.body;
    const d = date || new Date().toISOString().split('T')[0];
    const existing = await db.prepare('SELECT id FROM banking WHERE carpark_id = ? AND date = ?').get(carparkId, d);
    if (existing) {
      await db.prepare(`UPDATE banking SET eftpos_total=?, cash_total=?, account_total=?, other_total=?, notes=?, staff_id=? WHERE id=?`)
        .run(eftpos_total || 0, cash_total || 0, account_total || 0, other_total || 0, notes, req.session.userId, existing.id);
      const record = await db.prepare('SELECT * FROM banking WHERE id = ?').get(existing.id);
      return res.json(record);
    }
    const result = await db.prepare(`INSERT INTO banking (carpark_id, date, eftpos_total, cash_total, account_total, other_total, notes, staff_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(carparkId, d, eftpos_total || 0, cash_total || 0, account_total || 0, other_total || 0, notes, req.session.userId);
    const record = await db.prepare('SELECT * FROM banking WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(record);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/banking/autofill?date=YYYY-MM-DD
// Builds banking fields directly from invoice payment lines:
// - payment 1: paid_status + payment_amount
// - payment 2: paid_status_2 + payment_amount_2
router.get('/autofill', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const rows = await db.prepare(`
      SELECT paid_status, payment_amount, paid_status_2, payment_amount_2
      FROM invoices
      WHERE carpark_id = ? AND DATE(date_in) = ? AND void = 0
    `).all(carparkId, date);

    let eftpos = 0;
    let cash = 0;
    let account = 0;
    let other = 0;

    const addByStatus = (statusRaw, amountRaw) => {
      const status = String(statusRaw || '').trim();
      const amount = parseFloat(amountRaw || 0) || 0;
      if (amount <= 0) return;
      if (status === 'Eftpos') eftpos += amount;
      else if (status === 'Cash') cash += amount;
      else if (status === 'OnAcc') account += amount;
      else if (status && status !== 'To Pay') other += amount;
    };

    for (const r of rows) {
      addByStatus(r.paid_status, r.payment_amount);
      addByStatus(r.paid_status_2, r.payment_amount_2);
    }

    const round2 = (n) => Math.round((n || 0) * 100) / 100;
    res.json({
      date,
      eftpos: round2(eftpos),
      cash: round2(cash),
      account: round2(account),
      other: round2(other),
      total: round2(eftpos + cash + account + other)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/petty-cash', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const { from, to } = req.query;
    const today = new Date().toISOString().split('T')[0];
    const fromDate = from || new Date(new Date().setDate(1)).toISOString().split('T')[0];
    const toDate = to || today;
    const records = await db.prepare(`SELECT pc.*, u.name as staff_name FROM petty_cash pc LEFT JOIN users u ON pc.staff_id = u.id WHERE pc.carpark_id = ? AND pc.date >= ? AND pc.date <= ? ORDER BY pc.date DESC, pc.id DESC`).all(carparkId, fromDate, toDate);
    const summary = await db.prepare(`SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) as income, COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) as expense FROM petty_cash WHERE carpark_id = ? AND date >= ? AND date <= ?`).get(carparkId, fromDate, toDate);
    res.json({ records, summary, fromDate, toDate });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/petty-cash', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const { date, description, amount, type, category } = req.body;
    const result = await db.prepare(`INSERT INTO petty_cash (carpark_id, date, description, amount, type, category, staff_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(carparkId, date || new Date().toISOString().split('T')[0], description, amount, type, category, req.session.userId);
    const record = await db.prepare('SELECT * FROM petty_cash WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(record);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/petty-cash/:id', requireAuth, async (req, res) => {
  try {
    await db.prepare('DELETE FROM petty_cash WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
