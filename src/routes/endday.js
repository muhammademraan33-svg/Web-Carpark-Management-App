const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { businessDateYmd } = require('../utils/businessDate');
const { EFFECTIVE_PAY1_DAY, EFFECTIVE_PAY2_DAY } = require('../utils/invoicePaymentDates');
const router = express.Router();

async function ensureEndDayInternetColumn() {
  try {
    await db.prepare(`ALTER TABLE end_day ADD COLUMN internet_banking_total REAL DEFAULT 0`).run();
  } catch (_) {
    // Column already exists (or migration already applied).
  }
}

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
          COALESCE(CASE WHEN (${EFFECTIVE_PAY1_DAY}) = ? AND paid_status = 'Internet Banking' THEN payment_amount ELSE 0 END, 0) +
          COALESCE(CASE WHEN (${EFFECTIVE_PAY2_DAY}) IS NOT NULL AND (${EFFECTIVE_PAY2_DAY}) = ? AND paid_status_2 = 'Internet Banking' THEN payment_amount_2 ELSE 0 END, 0)
        ), 0) as internet_banking,
        COALESCE(SUM(
          COALESCE(CASE WHEN (${EFFECTIVE_PAY1_DAY}) = ? AND paid_status != 'To Pay' THEN payment_amount ELSE 0 END, 0) +
          COALESCE(CASE WHEN (${EFFECTIVE_PAY2_DAY}) IS NOT NULL AND (${EFFECTIVE_PAY2_DAY}) = ? AND paid_status_2 != 'To Pay' THEN payment_amount_2 ELSE 0 END, 0)
        ), 0) as total_revenue
      FROM invoices WHERE carpark_id = ? AND void = 0
    `).get(today, today, today, today, today, today, today, today, today, today, today, today, carparkId);
    const carsInYard   = await db.prepare(`SELECT COUNT(*) as count FROM invoices WHERE carpark_id = ? AND void = 0 AND picked_up = 'Car In Yard'`).get(carparkId);
    const invoices     = await db.prepare(`SELECT i.*, u.name as staff_name FROM invoices i LEFT JOIN users u ON i.staff_id = u.id WHERE i.carpark_id = ? AND DATE(i.date_in) = ? AND i.void = 0 ORDER BY i.time_in`).all(carparkId, today);
    const returningToday = await db.prepare(`SELECT i.*, u.name as staff_name FROM invoices i LEFT JOIN users u ON i.staff_id = u.id WHERE i.carpark_id = ? AND DATE(i.return_date) = ? AND i.void = 0 AND i.picked_up != 'Car In Yard' ORDER BY i.return_time`).all(carparkId, today);
    const record       = await db.prepare('SELECT * FROM end_day WHERE carpark_id = ? AND date = ?').get(carparkId, today);

    // Chronological payment activity (helps clients reconcile EOD totals vs actual deposits/receipts).
    // Includes:
    //   - invoice line 1 if effective pay day == today and the line is actually paid
    //   - invoice line 2 same logic
    //   - long-term payments on this date
    //   - account_customers payments on this date
    const invLine1Rows = await db.prepare(`
      SELECT
        i.id              AS invoice_id,
        i.invoice_number  AS invoice_number,
        i.first_name, i.last_name, i.rego,
        i.time_in         AS time_text,
        i.updated_at      AS updated_at,
        i.paid_status     AS method,
        i.payment_amount  AS amount,
        u.name            AS staff_name
      FROM invoices i
      LEFT JOIN users u ON i.staff_id = u.id
      WHERE i.carpark_id = ? AND i.void = 0
        AND (${EFFECTIVE_PAY1_DAY}) = ?
        AND COALESCE(i.paid_status,'') != 'To Pay'
        AND COALESCE(i.paid_status,'') != ''
        AND COALESCE(i.payment_amount,0) > 0
    `).all(carparkId, today);

    const invLine2Rows = await db.prepare(`
      SELECT
        i.id                AS invoice_id,
        i.invoice_number    AS invoice_number,
        i.first_name, i.last_name, i.rego,
        i.updated_at        AS time_text,
        i.updated_at        AS updated_at,
        i.paid_status_2     AS method,
        i.payment_amount_2  AS amount,
        u.name              AS staff_name
      FROM invoices i
      LEFT JOIN users u ON i.staff_id = u.id
      WHERE i.carpark_id = ? AND i.void = 0
        AND (${EFFECTIVE_PAY2_DAY}) IS NOT NULL
        AND (${EFFECTIVE_PAY2_DAY}) = ?
        AND COALESCE(i.paid_status_2,'') != 'To Pay'
        AND COALESCE(i.paid_status_2,'') != ''
        AND COALESCE(i.payment_amount_2,0) > 0
    `).all(carparkId, today);

    const ltActivity = await db.prepare(`
      SELECT
        p.id           AS payment_id,
        p.created_at   AS time_text,
        p.payment_date AS payment_date,
        p.amount_ex_gst AS amount_ex_gst,
        p.payment_method AS method,
        p.transaction_reference AS reference,
        lt.lt_number   AS lt_number,
        lt.name        AS customer_name
      FROM longterm_payments p
      LEFT JOIN longterm_customers lt ON lt.id = p.longterm_customer_id
      WHERE p.carpark_id = ? AND substr(trim(COALESCE(p.payment_date,'')),1,10) = ?
      ORDER BY p.created_at ASC
    `).all(carparkId, today);

    const acctActivity = await db.prepare(`
      SELECT
        p.id            AS payment_id,
        p.created_at    AS time_text,
        p.payment_date  AS payment_date,
        p.amount        AS amount,
        p.payment_method AS method,
        p.transaction_reference AS reference,
        ac.company_name AS company_name
      FROM account_payments p
      LEFT JOIN account_customers ac ON ac.id = p.account_customer_id
      WHERE p.carpark_id = ? AND substr(trim(COALESCE(p.payment_date,'')),1,10) = ?
      ORDER BY p.created_at ASC
    `).all(carparkId, today);

    const toHm = (raw) => {
      if (!raw) return '';
      const s = String(raw);
      // already HH:MM(:SS) style
      const m = s.match(/^(\d{1,2}):(\d{2})/);
      if (m) {
        const hh = String(parseInt(m[1], 10)).padStart(2, '0');
        return `${hh}:${m[2]}`;
      }
      // ISO / SQLite datetime
      const t = s.indexOf('T') >= 0 ? s.slice(s.indexOf('T') + 1) : (s.length >= 19 ? s.slice(11, 16) : '');
      const m2 = t.match(/^(\d{1,2}):(\d{2})/);
      if (m2) return `${String(parseInt(m2[1], 10)).padStart(2, '0')}:${m2[2]}`;
      return '';
    };

    const activity = [];
    for (const r of invLine1Rows) {
      activity.push({
        type: 'invoice',
        time: toHm(r.time_text),
        sort: r.time_text || r.updated_at || '',
        invoice_id: r.invoice_id,
        invoice_number: r.invoice_number,
        rego: r.rego || '',
        name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
        method: r.method || '',
        amount: parseFloat(r.amount || 0) || 0,
        staff: r.staff_name || '',
        line: 1
      });
    }
    for (const r of invLine2Rows) {
      activity.push({
        type: 'invoice',
        time: toHm(r.time_text),
        sort: r.time_text || r.updated_at || '',
        invoice_id: r.invoice_id,
        invoice_number: r.invoice_number,
        rego: r.rego || '',
        name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
        method: r.method || '',
        amount: parseFloat(r.amount || 0) || 0,
        staff: r.staff_name || '',
        line: 2
      });
    }
    for (const r of ltActivity) {
      activity.push({
        type: 'longterm',
        time: toHm(r.time_text),
        sort: r.time_text || '',
        lt_number: r.lt_number || '',
        name: r.customer_name || '',
        method: r.method || '',
        amount: parseFloat(r.amount_ex_gst || 0) || 0,
        reference: r.reference || ''
      });
    }
    for (const r of acctActivity) {
      activity.push({
        type: 'account',
        time: toHm(r.time_text),
        sort: r.time_text || '',
        name: r.company_name || '',
        method: r.method || '',
        amount: parseFloat(r.amount || 0) || 0,
        reference: r.reference || ''
      });
    }
    activity.sort((a, b) => {
      // Empty times sort to the end. Within times, ascending order is most useful for reconciling.
      if (!a.time && b.time) return 1;
      if (a.time && !b.time) return -1;
      if (a.time !== b.time) return a.time < b.time ? -1 : 1;
      return (a.sort || '') < (b.sort || '') ? -1 : 1;
    });

    res.json({
      date: today,
      stats: { ...stats, cars_in_yard: carsInYard.count || 0 },
      invoices,
      returningToday,
      record,
      activity
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const { date, notes } = req.body;
    const today = date || businessDateYmd();
    await ensureEndDayInternetColumn();
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
        ), 0) as on_account,
        COALESCE(SUM(
          COALESCE(CASE WHEN (${EFFECTIVE_PAY1_DAY}) = ? AND paid_status = 'Internet Banking' THEN payment_amount ELSE 0 END, 0) +
          COALESCE(CASE WHEN (${EFFECTIVE_PAY2_DAY}) IS NOT NULL AND (${EFFECTIVE_PAY2_DAY}) = ? AND paid_status_2 = 'Internet Banking' THEN payment_amount_2 ELSE 0 END, 0)
        ), 0) as internet_banking
      FROM invoices WHERE carpark_id = ? AND void = 0
    `).get(today, today, today, today, today, today, today, today, today, today, today, carparkId);
    const carsInYard = await db.prepare(`SELECT COUNT(*) as count FROM invoices WHERE carpark_id = ? AND void = 0 AND picked_up = 'Car In Yard'`).get(carparkId);
    const existing = await db.prepare('SELECT id FROM end_day WHERE carpark_id = ? AND date = ?').get(carparkId, today);
    if (existing) {
      await db.prepare(`UPDATE end_day SET total_revenue=?, cars_in=?, cars_in_yard=?, eftpos_total=?, cash_total=?, account_total=?, internet_banking_total=?, notes=?, staff_id=? WHERE id=?`)
        .run(stats.total_revenue, stats.cars_in, carsInYard.count || 0, stats.eftpos, stats.cash, stats.on_account, stats.internet_banking, notes, req.session.userId, existing.id);
    } else {
      await db.prepare(`INSERT INTO end_day (carpark_id, date, total_revenue, cars_in, cars_in_yard, eftpos_total, cash_total, account_total, internet_banking_total, notes, staff_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(carparkId, today, stats.total_revenue, stats.cars_in, carsInYard.count || 0, stats.eftpos, stats.cash, stats.on_account, stats.internet_banking, notes, req.session.userId);
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
