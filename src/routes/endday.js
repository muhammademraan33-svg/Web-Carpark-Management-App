const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { businessDateYmd } = require('../utils/businessDate');
const { EFFECTIVE_PAY1_DAY, EFFECTIVE_PAY2_DAY } = require('../utils/invoicePaymentDates');
const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const today = req.query.date || businessDateYmd();
    const stats = await db.prepare(`
      SELECT
        COUNT(CASE WHEN DATE(date_in) = ? THEN 1 END) as cars_in,
        COUNT(CASE WHEN DATE(return_date) = ? AND picked_up != 'Car In Yard' THEN 1 END) as cars_out,
        COALESCE(SUM(
          COALESCE(CASE WHEN (${EFFECTIVE_PAY1_DAY}) = ? AND paid_status = 'Eftpos' THEN payment_amount ELSE 0 END, 0) +
          COALESCE(CASE WHEN (${EFFECTIVE_PAY2_DAY}) IS NOT NULL AND (${EFFECTIVE_PAY2_DAY}) = ? AND paid_status_2 = 'Eftpos' THEN payment_amount_2 ELSE 0 END, 0)
        ), 0) as eftpos,
        COALESCE(SUM(
          COALESCE(CASE WHEN (${EFFECTIVE_PAY1_DAY}) = ? AND paid_status = 'Cash' THEN payment_amount ELSE 0 END, 0) +
          COALESCE(CASE WHEN (${EFFECTIVE_PAY2_DAY}) IS NOT NULL AND (${EFFECTIVE_PAY2_DAY}) = ? AND paid_status_2 = 'Cash' THEN payment_amount_2 ELSE 0 END, 0)
        ), 0) as cash,
        COALESCE(SUM(
          COALESCE(CASE WHEN (${EFFECTIVE_PAY1_DAY}) = ? AND paid_status = 'OnAcc' THEN payment_amount ELSE 0 END, 0) +
          COALESCE(CASE WHEN (${EFFECTIVE_PAY2_DAY}) IS NOT NULL AND (${EFFECTIVE_PAY2_DAY}) = ? AND paid_status_2 = 'OnAcc' THEN payment_amount_2 ELSE 0 END, 0)
        ), 0) as on_account,
        COALESCE(SUM(
          COALESCE(CASE WHEN (${EFFECTIVE_PAY1_DAY}) = ? AND paid_status != 'To Pay' THEN payment_amount ELSE 0 END, 0) +
          COALESCE(CASE WHEN (${EFFECTIVE_PAY2_DAY}) IS NOT NULL AND (${EFFECTIVE_PAY2_DAY}) = ? AND paid_status_2 != 'To Pay' THEN payment_amount_2 ELSE 0 END, 0)
        ), 0) as total_revenue
      FROM invoices WHERE carpark_id = ? AND void = 0
    `).get(today, today, today, today, today, today, today, today, today, today, carparkId);
    const carsInYard   = await db.prepare(`SELECT COUNT(*) as count FROM invoices WHERE carpark_id = ? AND void = 0 AND picked_up = 'Car In Yard'`).get(carparkId);
    const invoices     = await db.prepare(`SELECT i.*, u.name as staff_name FROM invoices i LEFT JOIN users u ON i.staff_id = u.id WHERE i.carpark_id = ? AND DATE(i.date_in) = ? AND i.void = 0 ORDER BY i.time_in`).all(carparkId, today);
    const returningToday = await db.prepare(`SELECT i.*, u.name as staff_name FROM invoices i LEFT JOIN users u ON i.staff_id = u.id WHERE i.carpark_id = ? AND DATE(i.return_date) = ? AND i.void = 0 AND i.picked_up != 'Car In Yard' ORDER BY i.return_time`).all(carparkId, today);
    const record       = await db.prepare('SELECT * FROM end_day WHERE carpark_id = ? AND date = ?').get(carparkId, today);
    res.json({ date: today, stats: { ...stats, cars_in_yard: carsInYard.count || 0 }, invoices, returningToday, record });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const { date, notes } = req.body;
    const today = date || businessDateYmd();
    const stats = await db.prepare(`
      SELECT
        COUNT(CASE WHEN DATE(date_in) = ? THEN 1 END) as cars_in,
        COALESCE(SUM(
          COALESCE(CASE WHEN (${EFFECTIVE_PAY1_DAY}) = ? AND paid_status != 'To Pay' THEN payment_amount ELSE 0 END, 0) +
          COALESCE(CASE WHEN (${EFFECTIVE_PAY2_DAY}) IS NOT NULL AND (${EFFECTIVE_PAY2_DAY}) = ? AND paid_status_2 != 'To Pay' THEN payment_amount_2 ELSE 0 END, 0)
        ), 0) as total_revenue,
        COALESCE(SUM(
          COALESCE(CASE WHEN (${EFFECTIVE_PAY1_DAY}) = ? AND paid_status = 'Eftpos' THEN payment_amount ELSE 0 END, 0) +
          COALESCE(CASE WHEN (${EFFECTIVE_PAY2_DAY}) IS NOT NULL AND (${EFFECTIVE_PAY2_DAY}) = ? AND paid_status_2 = 'Eftpos' THEN payment_amount_2 ELSE 0 END, 0)
        ), 0) as eftpos,
        COALESCE(SUM(
          COALESCE(CASE WHEN (${EFFECTIVE_PAY1_DAY}) = ? AND paid_status = 'Cash' THEN payment_amount ELSE 0 END, 0) +
          COALESCE(CASE WHEN (${EFFECTIVE_PAY2_DAY}) IS NOT NULL AND (${EFFECTIVE_PAY2_DAY}) = ? AND paid_status_2 = 'Cash' THEN payment_amount_2 ELSE 0 END, 0)
        ), 0) as cash,
        COALESCE(SUM(
          COALESCE(CASE WHEN (${EFFECTIVE_PAY1_DAY}) = ? AND paid_status = 'OnAcc' THEN payment_amount ELSE 0 END, 0) +
          COALESCE(CASE WHEN (${EFFECTIVE_PAY2_DAY}) IS NOT NULL AND (${EFFECTIVE_PAY2_DAY}) = ? AND paid_status_2 = 'OnAcc' THEN payment_amount_2 ELSE 0 END, 0)
        ), 0) as on_account
      FROM invoices WHERE carpark_id = ? AND void = 0
    `).get(today, today, today, today, today, today, today, today, today, carparkId);
    const carsInYard = await db.prepare(`SELECT COUNT(*) as count FROM invoices WHERE carpark_id = ? AND void = 0 AND picked_up = 'Car In Yard'`).get(carparkId);
    const existing = await db.prepare('SELECT id FROM end_day WHERE carpark_id = ? AND date = ?').get(carparkId, today);
    if (existing) {
      await db.prepare(`UPDATE end_day SET total_revenue=?, cars_in=?, cars_in_yard=?, eftpos_total=?, cash_total=?, account_total=?, notes=?, staff_id=? WHERE id=?`)
        .run(stats.total_revenue, stats.cars_in, carsInYard.count || 0, stats.eftpos, stats.cash, stats.on_account, notes, req.session.userId, existing.id);
    } else {
      await db.prepare(`INSERT INTO end_day (carpark_id, date, total_revenue, cars_in, cars_in_yard, eftpos_total, cash_total, account_total, notes, staff_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(carparkId, today, stats.total_revenue, stats.cars_in, carsInYard.count || 0, stats.eftpos, stats.cash, stats.on_account, notes, req.session.userId);
    }
    res.json({ success: true, stats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/history', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const records = await db.prepare(`SELECT ed.*, u.name as staff_name FROM end_day ed LEFT JOIN users u ON ed.staff_id = u.id WHERE ed.carpark_id = ? ORDER BY ed.date DESC LIMIT 30`).all(carparkId);
    res.json(records);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
