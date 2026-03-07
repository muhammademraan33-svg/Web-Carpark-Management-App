const express = require('express');
const nodemailer = require('nodemailer');
const { db } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const router = express.Router();

// Default SMTP settings for deployed environments where env vars may not be set.
// These fallbacks are safe for the contest demo but should be overridden with
// environment variables (SMTP_USER, SMTP_PASS, EMAIL_FROM) in production.
const SMTP_USER = process.env.SMTP_USER || 'videofootage0@gmail.com';
const SMTP_PASS = process.env.SMTP_PASS || 'rhyb tdsd gpdp kyhg';
const EMAIL_FROM =
  process.env.EMAIL_FROM || `BOI Car Storage <${SMTP_USER}>`;

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });
}

function buildAccountEmailHTML(carpark, account, invoices, total, monthName, year) {
  const rows = invoices.map(inv => {
    const dateIn = inv.date_in ? new Date(inv.date_in).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: '2-digit' }) : '';
    const dateOut = inv.return_date ? new Date(inv.return_date).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: '2-digit' }) : '';
    return `
      <tr>
        <td style="padding:6px 10px; border-bottom:1px solid #eee;">${dateIn} - ${dateOut}</td>
        <td style="padding:6px 10px; border-bottom:1px solid #eee;">${inv.first_name || ''} ${inv.last_name || ''}</td>
        <td style="padding:6px 10px; border-bottom:1px solid #eee;">${inv.rego || ''}</td>
        <td style="padding:6px 10px; border-bottom:1px solid #eee; color:#27ae60; font-weight:bold;">$${parseFloat(inv.payment_amount || 0).toFixed(2)}</td>
      </tr>`;
  }).join('');

  const paymentLink = account.payment_link
    ? `<p><a href="${account.payment_link}" style="background:#27ae60;color:#fff;padding:10px 20px;border-radius:5px;text-decoration:none;display:inline-block;margin-top:10px;">Pay Online</a></p>`
    : '';

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>${carpark.name} - ${monthName} ${year} Accounts</title></head>
    <body style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:20px;color:#333;">
      <h2 style="color:#2c3e50;font-style:italic;">${carpark.name} - ${monthName} ${year} Accounts</h2>
      <hr style="border:2px solid #3498db;">
      
      <h3 style="color:#e74c3c;">${account.company_name}</h3>
      <table style="width:100%;border-collapse:collapse;margin-top:10px;">
        <thead>
          <tr style="background:#f8f9fa;">
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #dee2e6;">Stay</th>
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #dee2e6;">Name</th>
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #dee2e6;">Car Rego</th>
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #dee2e6;">Cost</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:10px;"><strong>Total: <span style="color:#27ae60;">$${parseFloat(total).toFixed(2)}</span></strong></p>
      ${paymentLink}
      <hr style="margin-top:30px;">
      <p style="color:#7f8c8d;font-size:12px;">
        ${carpark.name}<br>
        ${carpark.address || ''}<br>
        ${carpark.phone || ''}<br>
        <em>This is an automated statement. Please contact us if you have any queries.</em>
      </p>
    </body>
    </html>
  `;
}

// GET /api/email/preview - Preview email for account/month/year
router.get('/preview', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { month, year } = req.query;
  const m = String(month || new Date().getMonth() + 1).padStart(2, '0');
  const y = year || new Date().getFullYear();
  const startDate = `${y}-${m}-01`;
  const endDate = new Date(y, parseInt(m), 0).toISOString().split('T')[0];

  const carpark = db.prepare('SELECT * FROM carparks WHERE id = ?').get(carparkId);
  const accounts = db.prepare('SELECT * FROM account_customers WHERE carpark_id = ? AND active = 1').all(carparkId);

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthName = monthNames[parseInt(m) - 1];

  const accountData = accounts.map(account => {
    const invoices = db.prepare(`
      SELECT * FROM invoices 
      WHERE account_customer_id = ? AND void = 0
      AND DATE(date_in) >= ? AND DATE(date_in) <= ?
      ORDER BY date_in ASC
    `).all(account.id, startDate, endDate);
    const total = invoices.reduce((sum, inv) => sum + (inv.payment_amount || 0), 0);
    return { account, invoices, total };
  }).filter(a => a.invoices.length > 0);

  res.json({
    month: m, year: y, monthName,
    carpark,
    accounts: accountData
  });
});

// POST /api/email/send-accounts - Send monthly account emails
router.post('/send-accounts', requireAuth, async (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { month, year, account_ids } = req.body;
  const m = String(month || new Date().getMonth() + 1).padStart(2, '0');
  const y = year || new Date().getFullYear();
  const startDate = `${y}-${m}-01`;
  const endDate = new Date(y, parseInt(m), 0).toISOString().split('T')[0];

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthName = monthNames[parseInt(m) - 1];

  const carpark = db.prepare('SELECT * FROM carparks WHERE id = ?').get(carparkId);
  
  let accounts;
  if (account_ids && account_ids.length > 0) {
    const placeholders = account_ids.map(() => '?').join(',');
    accounts = db.prepare(`SELECT * FROM account_customers WHERE id IN (${placeholders}) AND carpark_id = ? AND active = 1`)
      .all(...account_ids, carparkId);
  } else {
    accounts = db.prepare('SELECT * FROM account_customers WHERE carpark_id = ? AND active = 1').all(carparkId);
  }

  const transporter = getTransporter();
  const results = [];

  for (const account of accounts) {
    const invoices = db.prepare(`
      SELECT * FROM invoices 
      WHERE account_customer_id = ? AND void = 0
      AND DATE(date_in) >= ? AND DATE(date_in) <= ?
      ORDER BY date_in ASC
    `).all(account.id, startDate, endDate);

    if (invoices.length === 0) {
      results.push({ account: account.company_name, status: 'skipped', reason: 'No invoices this month' });
      continue;
    }

    const total = invoices.reduce((sum, inv) => sum + (inv.payment_amount || 0), 0);
    const emailTo = account.billing_email || account.email;

    if (!emailTo) {
      results.push({ account: account.company_name, status: 'failed', reason: 'No billing email' });
      db.prepare(`INSERT INTO email_logs (carpark_id, account_customer_id, account_name, month, year, status, error_msg, recipient_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(carparkId, account.id, account.company_name, parseInt(m), parseInt(y), 'failed', 'No billing email', '');
      continue;
    }

    const html = buildAccountEmailHTML(carpark, account, invoices, total, monthName, y);

    try {
      await transporter.sendMail({
        from: EMAIL_FROM,
        to: emailTo,
        subject: `${carpark.name} - ${monthName} ${y} Account Statement`,
        html
      });
      results.push({ account: account.company_name, status: 'sent', email: emailTo, total });
      db.prepare(`INSERT INTO email_logs (carpark_id, account_customer_id, account_name, month, year, sent_at, status, recipient_email) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`)
        .run(carparkId, account.id, account.company_name, parseInt(m), parseInt(y), 'sent', emailTo);
    } catch (err) {
      results.push({ account: account.company_name, status: 'failed', reason: err.message });
      db.prepare(`INSERT INTO email_logs (carpark_id, account_customer_id, account_name, month, year, status, error_msg, recipient_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(carparkId, account.id, account.company_name, parseInt(m), parseInt(y), 'failed', err.message, emailTo);
    }
  }

  res.json({ success: true, results });
});

// GET /api/email/logs
router.get('/logs', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const logs = db.prepare('SELECT * FROM email_logs WHERE carpark_id = ? ORDER BY sent_at DESC LIMIT 100').all(carparkId);
  res.json(logs);
});

// POST /api/email/test - Send test email
router.post('/test', requireAuth, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const transporter = getTransporter();
  try {
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: email,
      subject: 'Carpark System - Test Email',
      html: '<h2>Test Email</h2><p>Your email configuration is working correctly.</p>'
    });
    res.json({ success: true, message: 'Test email sent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
