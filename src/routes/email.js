const express = require('express');
const nodemailer = require('nodemailer');
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Hard-code the provided Gmail fallback so the deployed app works without
// the owner needing to set Vercel env vars for SMTP.
const SMTP_USER_DEFAULT = 'videofootage0@gmail.com';
const SMTP_PASS_DEFAULT = 'rhyb tdsd gpdp kyhg';
const SMTP_FROM_DEFAULT = `BOI Car Storage <${SMTP_USER_DEFAULT}>`;

function getTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER || SMTP_USER_DEFAULT,
      pass: process.env.SMTP_PASS || SMTP_PASS_DEFAULT,
    },
  });
}

function emailFrom() {
  return process.env.EMAIL_FROM || SMTP_FROM_DEFAULT;
}

function buildAccountEmailHTML(carpark, account, invoices, total, monthName, year) {
  const rows = invoices.map(inv => {
    const dIn  = inv.date_in     ? new Date(inv.date_in).toLocaleDateString('en-NZ',     { day: 'numeric', month: 'short', year: '2-digit' }) : '';
    const dOut = inv.return_date ? new Date(inv.return_date).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: '2-digit' }) : '';
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${dIn} – ${dOut}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${inv.first_name || ''} ${inv.last_name || ''}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${inv.rego || ''}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#27ae60;font-weight:bold;">$${parseFloat(inv.payment_amount || 0).toFixed(2)}</td>
    </tr>`;
  }).join('');

  const payLink = account.payment_link
    ? `<p><a href="${account.payment_link}" style="background:#27ae60;color:#fff;padding:10px 20px;border-radius:5px;text-decoration:none;display:inline-block;margin-top:10px;">Pay Online</a></p>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
  <body style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:20px;color:#333;">
    <h2 style="color:#2c3e50;font-style:italic;">${carpark.name} – ${monthName} ${year} Accounts</h2>
    <hr style="border:2px solid #3498db;">
    <h3 style="color:#e74c3c;">${account.company_name}</h3>
    <table style="width:100%;border-collapse:collapse;margin-top:10px;">
      <thead><tr style="background:#f8f9fa;">
        <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #dee2e6;">Stay</th>
        <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #dee2e6;">Name</th>
        <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #dee2e6;">Car Rego</th>
        <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #dee2e6;">Cost</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin-top:10px;"><strong>Total: <span style="color:#27ae60;">$${parseFloat(total).toFixed(2)}</span></strong></p>
    ${payLink}
    <hr style="margin-top:30px;">
    <p style="color:#7f8c8d;font-size:12px;">${carpark.name}<br>${carpark.address || ''}<br>${carpark.phone || ''}<br>
    <em>This is an automated statement. Please contact us if you have any queries.</em></p>
  </body></html>`;
}

// GET /api/email/preview
router.get('/preview', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const { month, year } = req.query;
    const m = String(month || new Date().getMonth() + 1).padStart(2, '0');
    const y = year || new Date().getFullYear();
    const startDate = `${y}-${m}-01`;
    const endDate   = new Date(y, parseInt(m), 0).toISOString().split('T')[0];
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const monthName  = monthNames[parseInt(m) - 1];
    const carpark    = await db.prepare('SELECT * FROM carparks WHERE id = ?').get(carparkId);
    const accounts   = await db.prepare('SELECT * FROM account_customers WHERE carpark_id = ? AND active = 1').all(carparkId);

    const accountData = [];
    for (const account of accounts) {
      const invoices = await db.prepare(`SELECT * FROM invoices WHERE account_customer_id = ? AND void = 0 AND DATE(date_in) >= ? AND DATE(date_in) <= ? ORDER BY date_in ASC`).all(account.id, startDate, endDate);
      if (invoices.length > 0) {
        const total = invoices.reduce((s, inv) => s + (inv.payment_amount || 0), 0);
        accountData.push({ account, invoices, total });
      }
    }
    res.json({ month: m, year: y, monthName, carpark, accounts: accountData });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/email/send-accounts
router.post('/send-accounts', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const { month, year, account_ids } = req.body;
    const m = String(month || new Date().getMonth() + 1).padStart(2, '0');
    const y = year || new Date().getFullYear();
    const startDate = `${y}-${m}-01`;
    const endDate   = new Date(y, parseInt(m), 0).toISOString().split('T')[0];
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const monthName  = monthNames[parseInt(m) - 1];
    const carpark    = await db.prepare('SELECT * FROM carparks WHERE id = ?').get(carparkId);

    let accounts;
    if (account_ids && account_ids.length > 0) {
      const ph = account_ids.map(() => '?').join(',');
      accounts = await db.prepare(`SELECT * FROM account_customers WHERE id IN (${ph}) AND carpark_id = ? AND active = 1`).all(...account_ids, carparkId);
    } else {
      accounts = await db.prepare('SELECT * FROM account_customers WHERE carpark_id = ? AND active = 1').all(carparkId);
    }

    const transporter = getTransporter();
    const results = [];

    for (const account of accounts) {
      const invoices = await db.prepare(`SELECT * FROM invoices WHERE account_customer_id = ? AND void = 0 AND DATE(date_in) >= ? AND DATE(date_in) <= ? ORDER BY date_in ASC`).all(account.id, startDate, endDate);
      if (invoices.length === 0) {
        results.push({ account: account.company_name, status: 'skipped', reason: 'No invoices this month' });
        continue;
      }
      const total   = invoices.reduce((s, inv) => s + (inv.payment_amount || 0), 0);
      const emailTo = account.billing_email || account.email;
      if (!emailTo) {
        results.push({ account: account.company_name, status: 'failed', reason: 'No billing email' });
        await db.prepare(`INSERT INTO email_logs (carpark_id, account_customer_id, account_name, month, year, status, error_msg, recipient_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(carparkId, account.id, account.company_name, parseInt(m), parseInt(y), 'failed', 'No billing email', '');
        continue;
      }
      const html = buildAccountEmailHTML(carpark, account, invoices, total, monthName, y);
      try {
        await transporter.sendMail({ from: emailFrom(), to: emailTo, subject: `${carpark.name} – ${monthName} ${y} Account Statement`, html });
        results.push({ account: account.company_name, status: 'sent', email: emailTo, total });
        await db.prepare(`INSERT INTO email_logs (carpark_id, account_customer_id, account_name, month, year, sent_at, status, recipient_email) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`)
          .run(carparkId, account.id, account.company_name, parseInt(m), parseInt(y), 'sent', emailTo);
      } catch (sendErr) {
        results.push({ account: account.company_name, status: 'failed', reason: sendErr.message });
        await db.prepare(`INSERT INTO email_logs (carpark_id, account_customer_id, account_name, month, year, status, error_msg, recipient_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(carparkId, account.id, account.company_name, parseInt(m), parseInt(y), 'failed', sendErr.message, emailTo);
      }
    }
    res.json({ success: true, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/email/logs
router.get('/logs', requireAuth, async (req, res) => {
  try {
    const logs = await db.prepare('SELECT * FROM email_logs WHERE carpark_id = ? ORDER BY sent_at DESC LIMIT 100').all(req.session.carparkId || 1);
    res.json(logs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/email/receipt/:invoiceId  – send an individual invoice receipt
router.post('/receipt/:invoiceId', requireAuth, async (req, res) => {
  const { invoiceId } = req.params;
  const carparkId = req.session.carparkId || 1;
  try {
    const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ? AND carpark_id = ?').get(invoiceId, carparkId);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const emailTo = invoice.email;
    if (!emailTo) return res.status(400).json({ error: 'No email address on this invoice' });

    const carpark = await db.prepare('SELECT * FROM carparks WHERE id = ?').get(carparkId);

    const fmt = (d) => d ? new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
    const currency = (n) => `$${parseFloat(n || 0).toFixed(2)}`;

    const paymentRows = `
      <tr><td style="padding:6px 10px;border-bottom:1px solid #eee;"><strong>Payment</strong></td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${invoice.paid_status || '—'}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${currency(invoice.payment_amount)}</td></tr>
      ${invoice.payment_amount_2 > 0 ? `
      <tr><td style="padding:6px 10px;border-bottom:1px solid #eee;"><strong>2nd Payment</strong></td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${invoice.paid_status_2 || '—'}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${currency(invoice.payment_amount_2)}</td></tr>` : ''}
    `;

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:20px;color:#333;">
  <div style="background:#2c3e50;color:#fff;padding:20px;border-radius:8px 8px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">${carpark ? carpark.name : 'Car Storage Yard'}</h1>
    <p style="margin:4px 0 0;font-size:13px;opacity:.8;">${carpark ? carpark.address || '' : ''}</p>
  </div>
  <div style="background:#f8f9fa;border:1px solid #dee2e6;border-top:none;padding:20px;border-radius:0 0 8px 8px;">
    <h2 style="color:#2c3e50;margin-top:0;">Receipt / Invoice #${invoice.invoice_number}</h2>

    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <tr><td style="padding:5px 0;width:140px;color:#666;">Customer</td>
          <td style="padding:5px 0;font-weight:bold;">${invoice.first_name || ''} ${invoice.last_name || ''}</td></tr>
      <tr><td style="padding:5px 0;color:#666;">Vehicle Rego</td>
          <td style="padding:5px 0;font-weight:bold;">${invoice.rego || '—'}</td></tr>
      <tr><td style="padding:5px 0;color:#666;">Key #</td>
          <td style="padding:5px 0;">${invoice.no_key ? 'No Key' : (invoice.key_number || '—')}</td></tr>
      <tr><td style="padding:5px 0;color:#666;">Date In</td>
          <td style="padding:5px 0;">${fmt(invoice.date_in)}${invoice.time_in ? ' at ' + invoice.time_in : ''}</td></tr>
      <tr><td style="padding:5px 0;color:#666;">Return Date</td>
          <td style="padding:5px 0;">${fmt(invoice.return_date)}${invoice.return_time ? ' at ' + invoice.return_time : ''}</td></tr>
      <tr><td style="padding:5px 0;color:#666;">Stay</td>
          <td style="padding:5px 0;">${invoice.stay_nights || 0} night(s)</td></tr>
      ${invoice.flight_info ? `<tr><td style="padding:5px 0;color:#666;">Flight</td>
          <td style="padding:5px 0;">${invoice.flight_info} (${invoice.flight_type || ''})</td></tr>` : ''}
    </table>

    <hr style="border:1px solid #dee2e6;margin:16px 0;">

    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
      ${invoice.discount_percent > 0 ? `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">Discount</td><td></td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:#e74c3c;">-${invoice.discount_percent}%</td></tr>` : ''}
      ${invoice.credit_applied > 0  ? `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">Credit Applied</td><td></td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:#3498db;">${currency(invoice.credit_applied)}</td></tr>` : ''}
      <tr style="background:#f8f9fa;"><td style="padding:10px;font-size:16px;font-weight:bold;" colspan="2">TOTAL</td>
          <td style="padding:10px;font-size:18px;font-weight:bold;color:#27ae60;text-align:right;">${currency(invoice.total_price)}</td></tr>
    </table>

    <table style="width:100%;border-collapse:collapse;">
      ${paymentRows}
    </table>

    ${invoice.notes ? `<p style="margin-top:16px;padding:10px;background:#fff3cd;border-radius:4px;font-size:13px;"><strong>Notes:</strong> ${invoice.notes}</p>` : ''}

    <hr style="border:1px solid #dee2e6;margin:20px 0 10px;">
    <p style="color:#7f8c8d;font-size:12px;text-align:center;margin:0;">
      Thank you for choosing ${carpark ? carpark.name : 'our Car Storage Yard'}<br>
      ${carpark ? carpark.phone || '' : ''}
    </p>
  </div>
</body></html>`;

    const transporter = getTransporter();
    await transporter.sendMail({
      from: emailFrom(),
      to: emailTo,
      subject: `Receipt – ${carpark ? carpark.name : 'Car Storage'} – Invoice #${invoice.invoice_number}`,
      html,
    });

    res.json({ success: true, message: `Receipt sent to ${emailTo}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/email/test
router.post('/test', requireAuth, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: emailFrom(),
      to: email,
      subject: 'Carpark System – Test Email',
      html: '<h2>✅ Test Email</h2><p>Your email configuration is working correctly.</p><p>Sent from BOI Car Storage system.</p>'
    });
    res.json({ success: true, message: `Test email sent to ${email}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
