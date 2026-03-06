const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET /api/banking
router.get('/', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { from, to } = req.query;
  const today = new Date().toISOString().split('T')[0];
  const fromDate = from || new Date(new Date().setDate(1)).toISOString().split('T')[0];
  const toDate = to || today;

  const records = db.prepare(`
    SELECT b.*, u.name as staff_name FROM banking b
    LEFT JOIN users u ON b.staff_id = u.id
    WHERE b.carpark_id = ? AND b.date >= ? AND b.date <= ?
    ORDER BY b.date DESC
  `).all(carparkId, fromDate, toDate);

  const summary = db.prepare(`
    SELECT COALESCE(SUM(eftpos_total),0) as eftpos, COALESCE(SUM(cash_total),0) as cash,
           COALESCE(SUM(account_total),0) as account, COALESCE(SUM(other_total),0) as other
    FROM banking WHERE carpark_id = ? AND date >= ? AND date <= ?
  `).get(carparkId, fromDate, toDate);

  res.json({ records, summary, fromDate, toDate });
});

// POST /api/banking
router.post('/', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { date, eftpos_total, cash_total, account_total, other_total, notes } = req.body;
  const d = date || new Date().toISOString().split('T')[0];

  const existing = db.prepare('SELECT id FROM banking WHERE carpark_id = ? AND date = ?').get(carparkId, d);
  if (existing) {
    db.prepare(`UPDATE banking SET eftpos_total=?, cash_total=?, account_total=?, other_total=?, notes=?, staff_id=? WHERE id=?`)
      .run(eftpos_total || 0, cash_total || 0, account_total || 0, other_total || 0, notes, req.session.userId, existing.id);
    const record = db.prepare('SELECT * FROM banking WHERE id = ?').get(existing.id);
    return res.json(record);
  }

  const result = db.prepare(`
    INSERT INTO banking (carpark_id, date, eftpos_total, cash_total, account_total, other_total, notes, staff_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(carparkId, d, eftpos_total || 0, cash_total || 0, account_total || 0, other_total || 0, notes, req.session.userId);
  const record = db.prepare('SELECT * FROM banking WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(record);
});

// GET /api/banking/petty-cash
router.get('/petty-cash', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { from, to } = req.query;
  const today = new Date().toISOString().split('T')[0];
  const fromDate = from || new Date(new Date().setDate(1)).toISOString().split('T')[0];
  const toDate = to || today;

  const records = db.prepare(`
    SELECT pc.*, u.name as staff_name FROM petty_cash pc
    LEFT JOIN users u ON pc.staff_id = u.id
    WHERE pc.carpark_id = ? AND pc.date >= ? AND pc.date <= ?
    ORDER BY pc.date DESC, pc.id DESC
  `).all(carparkId, fromDate, toDate);

  const summary = db.prepare(`
    SELECT 
      COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) as income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) as expense
    FROM petty_cash WHERE carpark_id = ? AND date >= ? AND date <= ?
  `).get(carparkId, fromDate, toDate);

  res.json({ records, summary, fromDate, toDate });
});

// POST /api/banking/petty-cash
router.post('/petty-cash', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { date, description, amount, type, category } = req.body;
  const result = db.prepare(`
    INSERT INTO petty_cash (carpark_id, date, description, amount, type, category, staff_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(carparkId, date || new Date().toISOString().split('T')[0], description, amount, type, category, req.session.userId);
  const record = db.prepare('SELECT * FROM petty_cash WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(record);
});

// DELETE /api/banking/petty-cash/:id
router.delete('/petty-cash/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM petty_cash WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
