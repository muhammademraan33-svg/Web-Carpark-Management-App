require('dotenv').config({ path: './config.env' });
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');
const cron = require('node-cron');

const { db, initializeDatabase } = require('./src/database');

const app = express();

// ─── Lazy DB initialisation ──────────────────────────────────────────────────
// On Vercel, module.exports is consumed before initializeDatabase() resolves,
// so we gate every request behind a single shared init promise.
let _dbInitPromise = null;
app.use((req, res, next) => {
  if (!_dbInitPromise) {
    _dbInitPromise = initializeDatabase().catch(err => {
      console.error('DB init failed:', err);
      _dbInitPromise = null; // allow retry on next request
      throw err;
    });
  }
  _dbInitPromise.then(() => next()).catch(() => {
    res.status(500).json({ error: 'Database initialisation failed. Please try again.' });
  });
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─── JWT session middleware ───────────────────────────────────────────────────
// Reads the signed JWT from the 'auth_token' httpOnly cookie and populates
// req.session so all existing route code (req.session.userId etc.) works
// unchanged.  No server-side state → works perfectly on Vercel serverless.
// We deliberately do NOT set the Secure cookie flag: Vercel's edge network
// already enforces HTTPS at the CDN layer, so there is no HTTP to protect
// against, and omitting Secure avoids the "secure cookie over HTTP" error that
// cookie-session threw when the internal serverless connection appeared as HTTP.
const JWT_SECRET = process.env.SESSION_SECRET || 'carpark_secret_2026';
app.use((req, res, next) => {
  req.session = {}; // always a plain object so req.session.x never throws
  const token = req.cookies && req.cookies.auth_token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.session.userId    = decoded.userId;
      req.session.username  = decoded.username;
      req.session.name      = decoded.name;
      req.session.role      = decoded.role;
      req.session.carparkId = decoded.carparkId;
    } catch (_) {
      // expired / tampered → req.session stays empty, treated as logged-out
    }
  }
  next();
});

// Serve static files – disable caching so browsers always get latest JS/HTML
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
}));

// API Routes
app.use('/api/auth',      require('./src/routes/auth'));
app.use('/api/dashboard', require('./src/routes/dashboard'));
app.use('/api/invoices',  require('./src/routes/invoices'));
app.use('/api/returns',   require('./src/routes/returns'));
app.use('/api/customers', require('./src/routes/customers'));
app.use('/api/longterm',  require('./src/routes/longterm'));
app.use('/api/accounts',  require('./src/routes/accounts'));
app.use('/api/keybox',    require('./src/routes/keybox'));
app.use('/api/reports',   require('./src/routes/reports'));
app.use('/api/email',     require('./src/routes/email'));
app.use('/api/banking',   require('./src/routes/banking'));
app.use('/api/admin',     require('./src/routes/admin'));
app.use('/api/endday',    require('./src/routes/endday'));
app.use('/api/flights',   require('./src/routes/flights'));

// ─── Diagnostic endpoint (no auth – safe, read-only) ─────────────────────────
app.get('/api/status', async (req, res) => {
  const USE_BLOB  = !!process.env.BLOB_READ_WRITE_TOKEN;
  const USE_TURSO = !!(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
  const info = {
    mode: USE_TURSO ? 'Turso' : USE_BLOB ? 'sql.js + Vercel Blob' : 'sql.js local (no persistence)',
    blob_token_set: USE_BLOB,
    turso_set: USE_TURSO,
    blobs: [],
    db_stats: {}
  };
  try {
    if (USE_BLOB) {
      const { list } = require('@vercel/blob');
      const { blobs } = await list({ prefix: 'carpark-db/', token: process.env.BLOB_READ_WRITE_TOKEN });
      info.blobs = blobs.map(b => ({ pathname: b.pathname, uploadedAt: b.uploadedAt, size: b.size }));
    }
    const invoiceCount = await db.prepare('SELECT COUNT(*) as c FROM invoices WHERE void = 0').get();
    const keyInUse     = await db.prepare("SELECT COUNT(*) as c FROM key_box WHERE status = 'in_use'").get();
    const keyAvail     = await db.prepare("SELECT COUNT(*) as c FROM key_box WHERE status = 'available'").get();
    info.db_stats = { invoices: invoiceCount.c, keys_in_use: keyInUse.c, keys_available: keyAvail.c };
  } catch (e) {
    info.error = e.message;
  }
  res.json(info);
});

// ─── Admin: hard-reset blob and re-seed DB ────────────────────────────────────
app.post('/api/admin/reset-db', async (req, res) => {
  // Require admin auth
  if (!req.session || req.session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const { list, del } = require('@vercel/blob');
      // Delete ALL carpark-db blobs (old and new naming schemes)
      const { blobs } = await list({ prefix: 'carpark-db/', token: process.env.BLOB_READ_WRITE_TOKEN });
      if (blobs.length) {
        await del(blobs.map(b => b.url), { token: process.env.BLOB_READ_WRITE_TOKEN });
        console.log(`[Reset] Deleted ${blobs.length} blob(s)`);
      }
    }
    // Force re-initialisation on the next request
    const dbModule = require('./src/database');
    await dbModule.resetDatabase();
    res.json({ success: true, message: 'Database reset. Refresh the app.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Root redirect
app.get('/', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/menu.html');
  }
  res.redirect('/login.html');
});

// ─── Scheduled job: send account emails on the 20th of each month at 8 AM ───
cron.schedule('0 8 20 * *', async () => {
  console.log('Running scheduled monthly account email job...');
  try {
    const nodemailer = require('nodemailer');

    const now = new Date();
    const month = now.getMonth() + 1;
    const year  = now.getFullYear();
    const m     = String(month).padStart(2, '0');
    const startDate = `${year}-${m}-01`;
    const endDate   = new Date(year, month, 0).toISOString().split('T')[0];
    const monthNames = ['January','February','March','April','May','June',
                        'July','August','September','October','November','December'];
    const monthName = monthNames[month - 1];

    const carparks = await db.prepare('SELECT * FROM carparks').all();

    for (const carpark of carparks) {
      const accounts = await db.prepare('SELECT * FROM account_customers WHERE carpark_id = ? AND active = 1').all(carpark.id);

      const transporter = nodemailer.createTransport({
        host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
        port:   parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth:   {
          user: process.env.SMTP_USER || 'videofootage0@gmail.com',
          pass: process.env.SMTP_PASS || 'rhyb tdsd gpdp kyhg'
        }
      });

      for (const account of accounts) {
        const invoices = await db.prepare(`
          SELECT * FROM invoices WHERE account_customer_id = ? AND void = 0
          AND DATE(date_in) >= ? AND DATE(date_in) <= ?
          ORDER BY date_in ASC
        `).all(account.id, startDate, endDate);

        if (invoices.length === 0) continue;

        const emailTo = account.billing_email || account.email;
        if (!emailTo) continue;

        const total = invoices.reduce((s, inv) => s + (inv.payment_amount || 0), 0);
        const rows  = invoices.map(inv => {
          const dIn  = inv.date_in     ? new Date(inv.date_in).toLocaleDateString('en-NZ',     { day:'numeric', month:'short', year:'2-digit' }) : '';
          const dOut = inv.return_date ? new Date(inv.return_date).toLocaleDateString('en-NZ', { day:'numeric', month:'short', year:'2-digit' }) : '';
          return `<tr><td>${dIn} - ${dOut}</td><td>${inv.first_name||''} ${inv.last_name||''}</td><td>${inv.rego||''}</td><td>$${parseFloat(inv.payment_amount||0).toFixed(2)}</td></tr>`;
        }).join('');

        const paymentLink = account.payment_link
          ? `<p><a href="${account.payment_link}" style="background:#27ae60;color:#fff;padding:10px 20px;border-radius:5px;text-decoration:none;">Pay Online</a></p>`
          : '';

        const html = `<!DOCTYPE html><html><body style="font-family:Arial;max-width:700px;margin:0 auto;padding:20px;">
          <h2 style="color:#2c3e50;font-style:italic;">${carpark.name} - ${monthName} ${year} Accounts</h2><hr>
          <h3 style="color:#e74c3c;">${account.company_name}</h3>
          <table border="1" cellpadding="8" cellspacing="0" width="100%">
            <tr><th>Stay</th><th>Name</th><th>Car Rego</th><th>Cost</th></tr>${rows}
          </table>
          <p><strong>Total: <span style="color:#27ae60;">$${parseFloat(total).toFixed(2)}</span></strong></p>
          ${paymentLink}
        </body></html>`;

        try {
          await transporter.sendMail({
            from: process.env.EMAIL_FROM || `BOI Car Storage <videofootage0@gmail.com>`,
            to:   emailTo,
            subject: `${carpark.name} - ${monthName} ${year} Account Statement`,
            html
          });
          await db.prepare(`INSERT INTO email_logs
            (carpark_id, account_customer_id, account_name, month, year, sent_at, status, recipient_email)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`)
            .run(carpark.id, account.id, account.company_name, month, year, 'sent', emailTo);
          console.log(`Sent account email to ${emailTo}`);
        } catch (err) {
          console.error(`Failed to send to ${emailTo}:`, err.message);
          await db.prepare(`INSERT INTO email_logs
            (carpark_id, account_customer_id, account_name, month, year, status, error_msg, recipient_email)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(carpark.id, account.id, account.company_name, month, year, 'failed', err.message, emailTo);
        }
      }
    }
    console.log('Monthly account emails completed.');
  } catch (err) {
    console.error('Cron job error:', err);
  }
});

// ─── Local dev: start the HTTP server ────────────────────────────────────────
// On Vercel this file is imported as a module; app.listen() must NOT be called.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  initializeDatabase().then(() => {
    app.listen(PORT, () => {
      console.log(`\n================================================`);
      console.log(`  BOI Car Storage - Carpark Management System`);
      console.log(`  Running at: http://localhost:${PORT}`);
      console.log(`  Default login: admin / Admin@BOI2026!Secure`);
      console.log(`  Staff login:   staff / Staff@BOI2026!Secure`);
      console.log(`================================================\n`);
    });
  }).catch(err => {
    console.error('Failed to initialise database:', err);
    process.exit(1);
  });
}

// Export for Vercel (and tests)
module.exports = app;
