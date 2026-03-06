require('dotenv').config({ path: './config.env' });
const express = require('express');
const session = require('express-session');
const path = require('path');
const cron = require('node-cron');
const MemoryStore = require('memorystore')(session);

const { db, initializeDatabase } = require('./src/database');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessions (in-memory store – pure JS, no native deps)
app.use(session({
  store: new MemoryStore({ checkPeriod: 86400000 }), // prune expired sessions every 24h
  secret: process.env.SESSION_SECRET || 'carpark_secret_2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000 // 8 hours
  }
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

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

    const carparks = db.prepare('SELECT * FROM carparks').all();

    for (const carpark of carparks) {
      const accounts = db.prepare('SELECT * FROM account_customers WHERE carpark_id = ? AND active = 1').all(carpark.id);

      const transporter = nodemailer.createTransport({
        host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
        port:   parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });

      for (const account of accounts) {
        const invoices = db.prepare(`
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
            from: process.env.EMAIL_FROM || carpark.email,
            to:   emailTo,
            subject: `${carpark.name} - ${monthName} ${year} Account Statement`,
            html
          });
          db.prepare(`INSERT INTO email_logs
            (carpark_id, account_customer_id, account_name, month, year, sent_at, status, recipient_email)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`)
            .run(carpark.id, account.id, account.company_name, month, year, 'sent', emailTo);
          console.log(`Sent account email to ${emailTo}`);
        } catch (err) {
          console.error(`Failed to send to ${emailTo}:`, err.message);
          db.prepare(`INSERT INTO email_logs
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

// ─── Start server after DB is ready ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;

initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`\n================================================`);
    console.log(`  BOI Car Storage - Carpark Management System`);
    console.log(`  Running at: http://localhost:${PORT}`);
    console.log(`  Default login: admin / admin123`);
    console.log(`  Staff login:   staff / staff123`);
    console.log(`================================================\n`);
  });
}).catch(err => {
  console.error('Failed to initialise database:', err);
  process.exit(1);
});

module.exports = app;
