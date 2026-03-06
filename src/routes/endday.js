const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET /api/endday - Get end of day summary for date
router.get('/', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { date } = req.query;
  const today = date || new Date().toISOString().split('T')[0];

  // Calculate from invoices
  const stats = db.prepare(`
    SELECT
      COUNT(CASE WHEN DATE(date_in) = ? THEN 1 END) as cars_in,
      COUNT(CASE WHEN DATE(return_date) = ? AND picked_up != 'Car In Yard' THEN 1 END) as cars_out,
      COALESCE(SUM(CASE WHEN DATE(date_in) = ? AND paid_status='Eftpos' THEN payment_amount ELSE 0 END), 0) as eftpos,
      COALESCE(SUM(CASE WHEN DATE(date_in) = ? AND paid_status='Cash' THEN payment_amount ELSE 0 END), 0) as cash,
      COALESCE(SUM(CASE WHEN DATE(date_in) = ? AND paid_status='OnAcc' THEN payment_amount ELSE 0 END), 0) as on_account,
      COALESCE(SUM(CASE WHEN DATE(date_in) = ? THEN (payment_amount + payment_amount_2) ELSE 0 END), 0) as total_revenue
    FROM invoices WHERE carpark_id = ? AND void = 0
  `).get(today, today, today, today, today, today, carparkId);

  // Cars currently in yard
  const carsInYard = db.prepare(`
    SELECT COUNT(*) as count FROM invoices 
    WHERE carpark_id = ? AND void = 0 AND picked_up = 'Car In Yard'
  `).get(carparkId);

  // Get today's invoices
  const invoices = db.prepare(`
    SELECT i.*, u.name as staff_name
    FROM invoices i
    LEFT JOIN users u ON i.staff_id = u.id
    WHERE i.carpark_id = ? AND DATE(i.date_in) = ? AND i.void = 0
    ORDER BY i.time_in
  `).all(carparkId, today);

  // Get cars returning today (for out count)
  const returningToday = db.prepare(`
    SELECT i.*, u.name as staff_name
    FROM invoices i
    LEFT JOIN users u ON i.staff_id = u.id
    WHERE i.carpark_id = ? AND DATE(i.return_date) = ? AND i.void = 0 AND i.picked_up != 'Car In Yard'
    ORDER BY i.return_time
  `).all(carparkId, today);

  // Existing end day record
  const record = db.prepare('SELECT * FROM end_day WHERE carpark_id = ? AND date = ?').get(carparkId, today);

  res.json({
    date: today,
    stats: { ...stats, cars_in_yard: carsInYard.count },
    invoices,
    returningToday,
    record
  });
});

// POST /api/endday - Save end of day
router.post('/', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { date, notes } = req.body;
  const today = date || new Date().toISOString().split('T')[0];

  // Calculate totals
  const stats = db.prepare(`
    SELECT
      COUNT(CASE WHEN DATE(date_in) = ? THEN 1 END) as cars_in,
      COALESCE(SUM(CASE WHEN DATE(date_in) = ? THEN (payment_amount + payment_amount_2) ELSE 0 END), 0) as total_revenue,
      COALESCE(SUM(CASE WHEN DATE(date_in) = ? AND paid_status='Eftpos' THEN payment_amount ELSE 0 END), 0) as eftpos,
      COALESCE(SUM(CASE WHEN DATE(date_in) = ? AND paid_status='Cash' THEN payment_amount ELSE 0 END), 0) as cash,
      COALESCE(SUM(CASE WHEN DATE(date_in) = ? AND paid_status='OnAcc' THEN payment_amount ELSE 0 END), 0) as on_account
    FROM invoices WHERE carpark_id = ? AND void = 0
  `).get(today, today, today, today, today, carparkId);

  const carsInYard = db.prepare(`
    SELECT COUNT(*) as count FROM invoices 
    WHERE carpark_id = ? AND void = 0 AND picked_up = 'Car In Yard'
  `).get(carparkId);

  const existing = db.prepare('SELECT id FROM end_day WHERE carpark_id = ? AND date = ?').get(carparkId, today);
  
  if (existing) {
    db.prepare(`UPDATE end_day SET total_revenue=?, cars_in=?, cars_in_yard=?, eftpos_total=?, cash_total=?, account_total=?, notes=?, staff_id=? WHERE id=?`)
      .run(stats.total_revenue, stats.cars_in, carsInYard.count, stats.eftpos, stats.cash, stats.on_account, notes, req.session.userId, existing.id);
  } else {
    db.prepare(`INSERT INTO end_day (carpark_id, date, total_revenue, cars_in, cars_in_yard, eftpos_total, cash_total, account_total, notes, staff_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(carparkId, today, stats.total_revenue, stats.cars_in, carsInYard.count, stats.eftpos, stats.cash, stats.on_account, notes, req.session.userId);
  }

  res.json({ success: true, stats });
});

// GET /api/endday/history
router.get('/history', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const records = db.prepare(`
    SELECT ed.*, u.name as staff_name FROM end_day ed
    LEFT JOIN users u ON ed.staff_id = u.id
    WHERE ed.carpark_id = ? ORDER BY ed.date DESC LIMIT 30
  `).all(carparkId);
  res.json(records);
});

module.exports = router;
