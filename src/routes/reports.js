const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');
const PDFDocument = require('pdfkit');
const router = express.Router();

// GET /api/reports/revenue
router.get('/revenue', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { from, to, group_by } = req.query;
  const today = new Date().toISOString().split('T')[0];
  const fromDate = from || new Date(new Date().setDate(1)).toISOString().split('T')[0];
  const toDate = to || today;

  let groupExpr = "DATE(date_in)";
  if (group_by === 'week') groupExpr = "strftime('%Y-W%W', date_in)";
  else if (group_by === 'month') groupExpr = "strftime('%Y-%m', date_in)";

  const revenue = db.prepare(`
    SELECT 
      ${groupExpr} as period,
      COUNT(*) as invoices,
      COALESCE(SUM(payment_amount + payment_amount_2), 0) as total,
      COALESCE(SUM(CASE WHEN paid_status = 'Eftpos' THEN payment_amount ELSE 0 END), 0) as eftpos,
      COALESCE(SUM(CASE WHEN paid_status = 'Cash' THEN payment_amount ELSE 0 END), 0) as cash,
      COALESCE(SUM(CASE WHEN paid_status = 'OnAcc' THEN payment_amount ELSE 0 END), 0) as on_account,
      COALESCE(SUM(CASE WHEN paid_status = 'To Pay' THEN total_price ELSE 0 END), 0) as outstanding
    FROM invoices
    WHERE carpark_id = ? AND void = 0
    AND DATE(date_in) >= ? AND DATE(date_in) <= ?
    GROUP BY ${groupExpr}
    ORDER BY period DESC
  `).all(carparkId, fromDate, toDate);

  const summary = db.prepare(`
    SELECT
      COUNT(*) as total_invoices,
      COALESCE(SUM(payment_amount + payment_amount_2), 0) as total_revenue,
      COALESCE(SUM(CASE WHEN paid_status = 'Eftpos' THEN payment_amount ELSE 0 END), 0) as eftpos_total,
      COALESCE(SUM(CASE WHEN paid_status = 'Cash' THEN payment_amount ELSE 0 END), 0) as cash_total,
      COALESCE(SUM(CASE WHEN paid_status = 'OnAcc' THEN payment_amount ELSE 0 END), 0) as on_account_total,
      COALESCE(SUM(CASE WHEN paid_status = 'To Pay' THEN total_price ELSE 0 END), 0) as outstanding_total
    FROM invoices
    WHERE carpark_id = ? AND void = 0
    AND DATE(date_in) >= ? AND DATE(date_in) <= ?
  `).get(carparkId, fromDate, toDate);

  res.json({ revenue, summary, fromDate, toDate });
});

// GET /api/reports/occupancy
router.get('/occupancy', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { from, to } = req.query;
  const today = new Date().toISOString().split('T')[0];
  const fromDate = from || new Date(new Date().setDate(1)).toISOString().split('T')[0];
  const toDate = to || today;

  const carpark = db.prepare('SELECT capacity FROM carparks WHERE id = ?').get(carparkId);
  const capacity = carpark ? carpark.capacity : 100;

  // Daily occupancy (cars in yard each day)
  const occupancy = db.prepare(`
    SELECT 
      DATE(date_in) as date,
      COUNT(*) as cars_in,
      COUNT(CASE WHEN DATE(return_date) = DATE(date_in) THEN 1 END) as same_day,
      COUNT(CASE WHEN DATE(return_date) > DATE(date_in) THEN 1 END) as overnight
    FROM invoices
    WHERE carpark_id = ? AND void = 0
    AND DATE(date_in) >= ? AND DATE(date_in) <= ?
    GROUP BY DATE(date_in)
    ORDER BY date DESC
  `).all(carparkId, fromDate, toDate);

  res.json({ occupancy, capacity, fromDate, toDate });
});

// GET /api/reports/customers
router.get('/customers', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { from, to } = req.query;
  const today = new Date().toISOString().split('T')[0];
  const fromDate = from || new Date(new Date().setDate(1)).toISOString().split('T')[0];
  const toDate = to || today;

  // Top customers by visits
  const topCustomers = db.prepare(`
    SELECT 
      first_name || ' ' || last_name as name,
      phone,
      COUNT(*) as visits,
      COALESCE(SUM(total_price), 0) as total_spent,
      MAX(date_in) as last_visit
    FROM invoices
    WHERE carpark_id = ? AND void = 0
    AND DATE(date_in) >= ? AND DATE(date_in) <= ?
    AND (first_name IS NOT NULL OR last_name IS NOT NULL)
    GROUP BY LOWER(COALESCE(first_name,'') || LOWER(COALESCE(last_name,'')))
    ORDER BY visits DESC
    LIMIT 50
  `).all(carparkId, fromDate, toDate);

  // Account customer usage
  const accountUsage = db.prepare(`
    SELECT 
      ac.company_name,
      COUNT(i.id) as visits,
      COALESCE(SUM(i.payment_amount), 0) as total_billed
    FROM invoices i
    JOIN account_customers ac ON i.account_customer_id = ac.id
    WHERE i.carpark_id = ? AND i.void = 0
    AND DATE(i.date_in) >= ? AND DATE(i.date_in) <= ?
    GROUP BY i.account_customer_id
    ORDER BY total_billed DESC
  `).all(carparkId, fromDate, toDate);

  res.json({ topCustomers, accountUsage, fromDate, toDate });
});

// GET /api/reports/revenue/csv
router.get('/revenue/csv', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { from, to } = req.query;
  const fromDate = from || new Date(new Date().setDate(1)).toISOString().split('T')[0];
  const toDate = to || new Date().toISOString().split('T')[0];

  const invoices = db.prepare(`
    SELECT i.invoice_number, i.date_in, i.return_date, i.stay_nights,
           i.first_name || ' ' || i.last_name as customer_name,
           i.rego, i.make, i.total_price, i.paid_status, i.payment_amount,
           i.payment_amount_2, u.name as staff,
           COALESCE(ac.company_name, '') as account
    FROM invoices i
    LEFT JOIN users u ON i.staff_id = u.id
    LEFT JOIN account_customers ac ON i.account_customer_id = ac.id
    WHERE i.carpark_id = ? AND i.void = 0
    AND DATE(i.date_in) >= ? AND DATE(i.date_in) <= ?
    ORDER BY i.date_in ASC
  `).all(carparkId, fromDate, toDate);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="revenue-${fromDate}-to-${toDate}.csv"`);

  const header = 'Invoice,Date In,Return Date,Nights,Customer,Rego,Make,Total Price,Status,Payment 1,Payment 2,Account,Staff\n';
  const rows = invoices.map(i =>
    `${i.invoice_number},"${i.date_in}","${i.return_date || ''}",${i.stay_nights},"${i.customer_name}","${i.rego || ''}","${i.make || ''}",${i.total_price},${i.paid_status},${i.payment_amount},${i.payment_amount_2},"${i.account}","${i.staff || ''}"`
  ).join('\n');

  res.send(header + rows);
});

// GET /api/reports/revenue/pdf
router.get('/revenue/pdf', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { from, to } = req.query;
  const fromDate = from || new Date(new Date().setDate(1)).toISOString().split('T')[0];
  const toDate = to || new Date().toISOString().split('T')[0];

  const carpark = db.prepare('SELECT * FROM carparks WHERE id = ?').get(carparkId);
  const summary = db.prepare(`
    SELECT
      COUNT(*) as total_invoices,
      COALESCE(SUM(payment_amount + payment_amount_2), 0) as total_revenue,
      COALESCE(SUM(CASE WHEN paid_status='Eftpos' THEN payment_amount ELSE 0 END), 0) as eftpos,
      COALESCE(SUM(CASE WHEN paid_status='Cash' THEN payment_amount ELSE 0 END), 0) as cash,
      COALESCE(SUM(CASE WHEN paid_status='OnAcc' THEN payment_amount ELSE 0 END), 0) as on_account
    FROM invoices WHERE carpark_id = ? AND void = 0
    AND DATE(date_in) >= ? AND DATE(date_in) <= ?
  `).get(carparkId, fromDate, toDate);

  const dailyRevenue = db.prepare(`
    SELECT DATE(date_in) as date,
           COUNT(*) as count,
           COALESCE(SUM(payment_amount + payment_amount_2), 0) as total
    FROM invoices WHERE carpark_id = ? AND void = 0
    AND DATE(date_in) >= ? AND DATE(date_in) <= ?
    GROUP BY DATE(date_in) ORDER BY date ASC
  `).all(carparkId, fromDate, toDate);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="revenue-report-${fromDate}.pdf"`);

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(res);

  doc.fontSize(18).font('Helvetica-Bold').text(carpark.name || 'Car Storage Yard', { align: 'center' });
  doc.fontSize(12).font('Helvetica').text(`Revenue Report: ${fromDate} to ${toDate}`, { align: 'center' });
  doc.moveDown();

  // Summary
  doc.fontSize(13).font('Helvetica-Bold').text('Summary');
  doc.fontSize(10).font('Helvetica');
  doc.text(`Total Invoices: ${summary.total_invoices}`);
  doc.text(`Total Revenue: $${parseFloat(summary.total_revenue).toFixed(2)}`);
  doc.text(`Eftpos: $${parseFloat(summary.eftpos).toFixed(2)}`);
  doc.text(`Cash: $${parseFloat(summary.cash).toFixed(2)}`);
  doc.text(`On Account: $${parseFloat(summary.on_account).toFixed(2)}`);
  doc.moveDown();

  // Daily table
  doc.fontSize(13).font('Helvetica-Bold').text('Daily Breakdown');
  doc.moveDown(0.3);

  // Table header
  doc.fontSize(9).font('Helvetica-Bold');
  doc.text('Date', 40, doc.y, { width: 100, continued: true });
  doc.text('Invoices', 140, doc.y - doc.currentLineHeight(), { width: 80, continued: true });
  doc.text('Revenue', 220, doc.y - doc.currentLineHeight(), { width: 100 });
  doc.moveDown(0.3);
  doc.moveTo(40, doc.y).lineTo(550, doc.y).stroke();
  doc.moveDown(0.2);

  doc.font('Helvetica').fontSize(9);
  dailyRevenue.forEach(row => {
    if (doc.y > 750) {
      doc.addPage();
    }
    const y = doc.y;
    doc.text(row.date, 40, y, { width: 100, continued: true });
    doc.text(String(row.count), 140, y, { width: 80, continued: true });
    doc.text(`$${parseFloat(row.total).toFixed(2)}`, 220, y, { width: 100 });
    doc.moveDown(0.2);
  });

  doc.end();
});

// GET /api/reports/customers/csv
router.get('/customers/csv', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { from, to } = req.query;
  const fromDate = from || new Date(new Date().setDate(1)).toISOString().split('T')[0];
  const toDate = to || new Date().toISOString().split('T')[0];

  const customers = db.prepare(`
    SELECT 
      first_name || ' ' || last_name as name,
      phone, rego,
      COUNT(*) as visits,
      COALESCE(SUM(total_price), 0) as total_spent,
      MAX(date_in) as last_visit
    FROM invoices
    WHERE carpark_id = ? AND void = 0
    AND DATE(date_in) >= ? AND DATE(date_in) <= ?
    GROUP BY LOWER(COALESCE(first_name,'') || LOWER(COALESCE(last_name,'')))
    ORDER BY visits DESC
  `).all(carparkId, fromDate, toDate);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="customer-report.csv"');

  const header = 'Name,Phone,Rego,Visits,Total Spent,Last Visit\n';
  const rows = customers.map(c =>
    `"${c.name}","${c.phone || ''}","${c.rego || ''}",${c.visits},${c.total_spent},"${c.last_visit || ''}"`
  ).join('\n');
  res.send(header + rows);
});

module.exports = router;
