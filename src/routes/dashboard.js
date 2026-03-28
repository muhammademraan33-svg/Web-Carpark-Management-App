const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { businessDateYmd, addCalendarDaysYmd } = require('../utils/businessDate');
const router = express.Router();

// GET /api/dashboard/stats
router.get('/stats', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const carparkId = req.session.carparkId || 1;
    const today = businessDateYmd();
    const firstOfMonth = today.substring(0, 8) + '01';

    const carsInYard     = await db.prepare(`SELECT COUNT(*) as count FROM invoices WHERE carpark_id = ? AND void = 0 AND picked_up = 'Car In Yard'`).get(carparkId);
    const revenueToday   = await db.prepare(`SELECT COALESCE(SUM(payment_amount + payment_amount_2), 0) as total FROM invoices WHERE carpark_id = ? AND DATE(date_in) = ? AND void = 0 AND paid_status != 'To Pay'`).get(carparkId, today);
    const revenueMonth   = await db.prepare(`SELECT COALESCE(SUM(payment_amount + payment_amount_2), 0) as total FROM invoices WHERE carpark_id = ? AND DATE(date_in) >= ? AND void = 0 AND paid_status != 'To Pay'`).get(carparkId, firstOfMonth);
    const carpark        = await db.prepare('SELECT capacity FROM carparks WHERE id = ?').get(carparkId);
    const carparkCapacity = carpark ? carpark.capacity : 100;
    // Short-term occupancy: same basis as Key Box — standard slots only (not LT), % = in_use / total slots
    const keyBoxFilter = `carpark_id = ? AND COALESCE(holder_type,'standard') != 'longterm'`;
    const keySlotsRow   = await db.prepare(`SELECT COUNT(*) as count FROM key_box WHERE ${keyBoxFilter}`).get(carparkId);
    const keysInUseRow  = await db.prepare(`SELECT COUNT(*) as count FROM key_box WHERE ${keyBoxFilter} AND status = 'in_use'`).get(carparkId);
    const totalSlots    = keySlotsRow.count || 0;
    const inUseSlots    = keysInUseRow.count || 0;
    // One decimal so e.g. 3/60 (5.0%) vs 3/64 (4.7%) don’t look identical after adding keys
    const occupancyRate = totalSlots > 0
      ? Math.min(100, Math.round((inUseSlots / totalSlots) * 1000) / 10)
      : 0;
    const carsInToday    = await db.prepare(`SELECT COUNT(*) as count FROM invoices WHERE carpark_id = ? AND DATE(date_in) = ? AND void = 0`).get(carparkId, today);
    // All cars scheduled to return today (matches Returns page default), not only "still in yard"
    const carsReturnToday= await db.prepare(`SELECT COUNT(*) as count FROM invoices WHERE carpark_id = ? AND DATE(return_date) = ? AND void = 0`).get(carparkId, today);
    const revenueByMethod= await db.prepare(`SELECT paid_status, COALESCE(SUM(payment_amount), 0) as total FROM invoices WHERE carpark_id = ? AND DATE(date_in) >= ? AND void = 0 GROUP BY paid_status`).all(carparkId, firstOfMonth);
    const recentInvoices = await db.prepare(`SELECT i.*, u.name as staff_name FROM invoices i LEFT JOIN users u ON i.staff_id = u.id WHERE i.carpark_id = ? AND i.void = 0 ORDER BY i.created_at DESC LIMIT 10`).all(carparkId);
    const onAccountBalance = await db.prepare(`SELECT COALESCE(SUM(payment_amount), 0) as total FROM invoices WHERE carpark_id = ? AND paid_status = 'OnAcc' AND void = 0`).get(carparkId);
    const availableKeys  = await db.prepare(`SELECT COUNT(*) as count FROM key_box WHERE carpark_id = ? AND status = 'available'`).get(carparkId);

    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const dateStr = addCalendarDaysYmd(today, -i);
      const rev = await db.prepare(`SELECT COALESCE(SUM(payment_amount + payment_amount_2), 0) as total FROM invoices WHERE carpark_id = ? AND DATE(date_in) = ? AND void = 0 AND paid_status != 'To Pay'`).get(carparkId, dateStr);
      last7Days.push({ date: dateStr, total: rev.total });
    }

    res.json({
      businessDate: today,
      carsInYard: carsInYard.count || 0,
      carparkCapacity,
      keySlotsTotal: totalSlots,
      keysInUse: inUseSlots,
      // legacy: occupancy denominator is now key slots (same as Key Box total), not carpark.capacity
      capacity: totalSlots,
      occupancyRate,
      revenueToday: revenueToday.total || 0, revenueMonth: revenueMonth.total || 0,
      carsInToday: carsInToday.count || 0, carsReturnToday: carsReturnToday.count || 0,
      revenueByMethod, recentInvoices, last7Days,
      onAccountBalance: onAccountBalance.total || 0, availableKeys: availableKeys.count || 0
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// GET /api/dashboard/carpark-info
router.get('/carpark-info', requireAuth, async (req, res) => {
  try {
    const carpark = await db.prepare('SELECT * FROM carparks WHERE id = ?').get(req.session.carparkId || 1);
    res.json(carpark || {});
  } catch (err) {
    res.status(500).json({ error: 'Failed to load carpark info' });
  }
});

module.exports = router;
