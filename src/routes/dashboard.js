const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET /api/dashboard/stats
router.get('/stats', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const today = new Date().toISOString().split('T')[0];
  const firstOfMonth = today.substring(0, 8) + '01';

  // Cars currently in yard (date_in <= today AND (return_date >= today OR picked_up = 'Car In Yard') AND void = 0)
  const carsInYard = db.prepare(`
    SELECT COUNT(*) as count FROM invoices 
    WHERE carpark_id = ? AND void = 0 AND picked_up = 'Car In Yard'
  `).get(carparkId);

  // Revenue today
  const revenueToday = db.prepare(`
    SELECT COALESCE(SUM(payment_amount + payment_amount_2), 0) as total
    FROM invoices 
    WHERE carpark_id = ? AND DATE(date_in) = ? AND void = 0 AND paid_status != 'To Pay'
  `).get(carparkId, today);

  // Revenue this month
  const revenueMonth = db.prepare(`
    SELECT COALESCE(SUM(payment_amount + payment_amount_2), 0) as total
    FROM invoices 
    WHERE carpark_id = ? AND DATE(date_in) >= ? AND void = 0 AND paid_status != 'To Pay'
  `).get(carparkId, firstOfMonth);

  // Occupancy rate
  const carpark = db.prepare('SELECT capacity FROM carparks WHERE id = ?').get(carparkId);
  const capacity = carpark ? carpark.capacity : 100;
  const occupancyRate = Math.min(100, Math.round((carsInYard.count / capacity) * 100));

  // Cars checked in today
  const carsInToday = db.prepare(`
    SELECT COUNT(*) as count FROM invoices
    WHERE carpark_id = ? AND DATE(date_in) = ? AND void = 0
  `).get(carparkId, today);

  // Cars returning today
  const carsReturnToday = db.prepare(`
    SELECT COUNT(*) as count FROM invoices
    WHERE carpark_id = ? AND DATE(return_date) = ? AND void = 0 AND picked_up = 'Car In Yard'
  `).get(carparkId, today);

  // Monthly revenue breakdown by payment method
  const revenueByMethod = db.prepare(`
    SELECT 
      paid_status,
      COALESCE(SUM(payment_amount), 0) as total
    FROM invoices
    WHERE carpark_id = ? AND DATE(date_in) >= ? AND void = 0
    GROUP BY paid_status
  `).all(carparkId, firstOfMonth);

  // Recent 10 invoices
  const recentInvoices = db.prepare(`
    SELECT i.*, u.name as staff_name 
    FROM invoices i
    LEFT JOIN users u ON i.staff_id = u.id
    WHERE i.carpark_id = ? AND i.void = 0
    ORDER BY i.created_at DESC LIMIT 10
  `).all(carparkId);

  // Revenue last 7 days
  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const rev = db.prepare(`
      SELECT COALESCE(SUM(payment_amount + payment_amount_2), 0) as total
      FROM invoices WHERE carpark_id = ? AND DATE(date_in) = ? AND void = 0 AND paid_status != 'To Pay'
    `).get(carparkId, dateStr);
    last7Days.push({ date: dateStr, total: rev.total });
  }

  // On-account balance total
  const onAccountBalance = db.prepare(`
    SELECT COALESCE(SUM(payment_amount), 0) as total FROM invoices
    WHERE carpark_id = ? AND paid_status = 'OnAcc' AND void = 0
  `).get(carparkId);

  // Available keys
  const availableKeys = db.prepare(`
    SELECT COUNT(*) as count FROM key_box WHERE carpark_id = ? AND status = 'available'
  `).get(carparkId);

  res.json({
    carsInYard: carsInYard.count,
    capacity,
    occupancyRate,
    revenueToday: revenueToday.total,
    revenueMonth: revenueMonth.total,
    carsInToday: carsInToday.count,
    carsReturnToday: carsReturnToday.count,
    revenueByMethod,
    recentInvoices,
    last7Days,
    onAccountBalance: onAccountBalance.total,
    availableKeys: availableKeys.count
  });
});

// GET /api/dashboard/carpark-info
router.get('/carpark-info', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const carpark = db.prepare('SELECT * FROM carparks WHERE id = ?').get(carparkId);
  res.json(carpark || {});
});

module.exports = router;
