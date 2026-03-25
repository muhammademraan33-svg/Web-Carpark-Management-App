/**
 * Seed NZ demo data into the SQLite file (same path as the running app).
 * - 31 short-term invoices → keys 1–31 in key_box (all Car In Yard, physical keys)
 * - 8 long-term customers → lt_key_slot 32–39, lt_in_yard = 1 (separate from standard keys)
 * - 10 on-account customers + email_logs + 5 invoices with return_date = business today (Returns)
 *
 *   node scripts/seed-nz-realistic.js --replace
 *   railway run node scripts/seed-nz-realistic.js --replace
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { db, initializeDatabase } = require('../src/database');
const { syncKeyBoxForPickedUp } = require('../src/utils/keyBoxSync');
const { businessDateYmd } = require('../src/utils/businessDate');
const { getNzSeedReport, reportPasses } = require('./verify-nz-seed.js');

const CARPARK_ID = 1;
const TARGET_INVOICES = 31;
const LT_COUNT = 8;
const LT_KEY_START = 32;
const RETURNS_COUNT = 5;

const NZ_FIRST = [
  'Wiremu', 'Emily', 'James', 'Aroha', 'Tom', 'Sofia', 'Mereana', 'Liam', 'Isla', 'Rangi',
  'Charlotte', 'Hemi', 'Anna', 'Noah', 'Hannah', 'Marcus', 'Kate', 'Ben', 'Tessa', 'Oliver',
  'Ruby', 'Ethan', 'Lucy', 'Jack', 'Grace', 'Sam', 'Phoebe', 'Ryan', 'Mia', 'Finn', 'Zoe',
];
const NZ_LAST = [
  'Paterson', 'Fraser', "O'Connor", 'Ngata', "O'Brien", 'Chen', 'Thompson', 'Crawford', 'Macdonald', 'Williams',
  'Singh', 'Te Whata', 'van der Berg', 'Patel', 'Cooper', 'Tuiletufuga', 'Robertson', 'Hughes', 'Wong', 'Bruce',
  'Anderson', 'Davies', 'Taylor', 'Morrison', 'Nielsen', 'Wellington', 'Clarke', 'Ferguson', 'Young', 'McKenzie', 'Bennett',
];
/** 31 unique rego-style plates (avoid LT seed collisions) */
const REGOS = [
  'HNZ801', 'KPL402', 'QTM993', 'NZF441', 'YXP781', 'BVT552', 'LDR309', 'PKG612', 'WHT884', 'FJK192',
  'NXB556', 'VHT220', 'PWX912', 'RTP339', 'KLW902', 'JFB114', 'NQX556', 'TWX311', 'ZSR667', 'MYK448',
  'QWB990', 'HYP779', 'TJN334', 'FND882', 'BOI119', 'KKE554', 'AKL771', 'WLG303', 'CHC882', 'ZPL425', 'NPL901',
];

const PAID_ROT = ['Eftpos', 'Cash', 'To Pay', 'OnAcc', 'Eftpos', 'Eftpos'];

function nzInvoiceRows(returnsYmd) {
  const rows = [];
  const returnTimes = ['08:15', '10:30', '12:00', '14:15', '16:45'];
  for (let i = 0; i < TARGET_INVOICES; i++) {
    const kn = i + 1;
    const nights = (i % 7) + 1;
    const basePrice = [18, 32, 48, 56, 70, 84, 100][i % 7];
    const paid = PAID_ROT[i % PAID_ROT.length];
    const useAccount = paid === 'OnAcc';
    const accountSlot = (i % 10) + 1;

    const isReturnDemo = i < RETURNS_COUNT;
    const returnDate = isReturnDemo ? returnsYmd : `2026-03-${String(10 + (i % 15)).padStart(2, '0')}`;
    const returnTime = isReturnDemo ? returnTimes[i] : `${String(9 + (i % 8)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`;

    rows.push({
      invoice_number: 19500 + i,
      rego: REGOS[i],
      first_name: NZ_FIRST[i],
      last_name: NZ_LAST[i],
      phone: i % 2 === 0 ? `021 ${200 + i} ${1000 + i}` : `027 ${300 + i} ${4000 + i}`,
      email: `${NZ_FIRST[i].toLowerCase().replace(/[^a-z]/g, '')}.${NZ_LAST[i].toLowerCase().replace(/[^a-z]/g, '')}@${['gmail.com', 'xtra.co.nz', 'outlook.co.nz', 'icloud.com', 'yahoo.co.nz'][i % 5]}`,
      date_in: `2026-03-${String(1 + (i % 12)).padStart(2, '0')}`,
      time_in: `${String(7 + (i % 10)).padStart(2, '0')}:${String((i * 11) % 60).padStart(2, '0')}`,
      return_date: returnDate,
      return_time: returnTime,
      stay_nights: nights,
      flight_info: ['NZ523 AKL–KKE', 'NZ5257 WLG–KKE', 'NZ5077 KKE–AKL', 'NZ5257 KKE–WLG'][i % 4],
      total_price: basePrice + (i % 3) * 2,
      paid_status: paid,
      payment_amount: paid === 'To Pay' ? 0 : basePrice + (i % 3) * 2,
      payment_method: paid === 'Eftpos' ? 'Eftpos' : paid === 'Cash' ? 'Cash' : paid === 'OnAcc' ? 'On Account' : null,
      account_customer_id: useAccount ? accountSlot : null,
      key_number: kn,
      picked_up: 'Car In Yard',
      no_key: false,
      notes: i % 5 === 0 ? 'Bay of Islands / Kerikeri — short stay.' : null,
    });
  }
  return rows;
}

function nzLongTermRows() {
  const data = [
    ['LT1', 'Melissa Cooper', 'GUA500', '', '021 602 7711', 'melissa.c@xtra.co.nz', 125.0],
    ['LT2', 'Steve Hindmarsh', 'GZK80', '', '027 960 1425', 'steve.h@gmail.com', 125.0],
    ['LT3', 'Ben Dalton', 'QTB341', '', '021 432 5666', 'ben.dalton@outlook.co.nz', 125.0],
    ['LT4', 'Franco Lovrich', 'ZS6398', '', '020 418 0293', 'franco.l@yahoo.co.nz', 125.0],
    ['LT5', 'Jan Carter', 'KDS554', '', '021 881 2001', 'jan.carter@icloud.com', 125.0],
    ['LT6', 'Tony Chapman', 'LNP252', 'EUT929', '027 242 8605', 'tony.c@xtra.co.nz', 125.0],
    ['LT7', 'Adam Parore', 'AWY148', '', '021 781 2500', 'adam.p@gmail.com', 125.0],
    ['LT8', 'Geoff Tane', 'KXN786', '', '027 334 0099', 'geoff.tane@xtra.co.nz', 125.0],
  ];
  return data.map((row, idx) => ({
    lt_number: row[0],
    name: row[1],
    rego_1: row[2],
    rego_2: row[3],
    phone: row[4],
    email: row[5],
    rate: row[6],
    lt_key_slot: LT_KEY_START + idx,
    lt_in_yard: 1,
    expiry_date: '2027-06-30',
    payment_status: idx % 2 === 0 ? 'Paid' : 'Unpaid',
  }));
}

function nzAccountCustomers() {
  return [
    ['CTM Northland Travel', 'Karen Wells', '09 401 2300', 'accounts@ctm-northland.co.nz', 'accounts@ctm-northland.co.nz', 5, 'YXP781', ''],
    ['Far North District Council', 'Sarah Jones', '09 401 3111', 'vehicles@fndc.govt.nz', 'accounts@fndc.govt.nz', 0, 'FND882', ''],
    ['Top Energy Limited', 'Mike Brown', '09 407 7000', 'fleet@topenergy.co.nz', 'accounts@topenergy.co.nz', 0, 'TOP441', ''],
    ['Northland DHB Shuttle', 'Priya Naidu', '09 430 4100', 'transport@northlanddhb.org.nz', 'finance@northlanddhb.org.nz', 10, 'NHB902', ''],
    ['Kerikeri IT Services Ltd', 'Dave Robertson', '09 407 8899', 'hello@kerikeriit.co.nz', 'accounts@kerikeriit.co.nz', 0, 'KIT112', ''],
    ['Bay of Islands Tourism Co-op', 'Lisa Chen', '09 407 1234', 'ops@boitourism.co.nz', 'accounts@boitourism.co.nz', 7, 'BOI119', ''],
    ['Whangārei Marine Services', 'Greg Hughes', '09 438 5500', 'yard@whangareimarine.co.nz', 'accounts@whangareimarine.co.nz', 0, 'WMS303', ''],
    ['Paihia Coaches & Rentals', 'Anahera King', '09 402 0005', 'bookings@paihiacoaches.co.nz', 'accounts@paihiacoaches.co.nz', 0, 'PCH554', ''],
    ['Northland Electrical Wholesale', 'Chris Patel', '09 438 2200', 'chris@newl.co.nz', 'accounts@newl.co.nz', 0, 'NEW882', ''],
    ['Kaitaia Freight Forwarders', 'Moana Rātena', '09 408 7700', 'dispatch@kff.co.nz', 'accounts@kff.co.nz', 0, 'KFF901', ''],
  ];
}

async function insertInvoiceWithCustomer(row, staffId) {
  const ic = await db.prepare(
    `INSERT INTO customers (first_name, last_name, phone, email, carpark_id) VALUES (?, ?, ?, ?, ?)`
  ).run(row.first_name, row.last_name, row.phone, row.email || null, CARPARK_ID);
  const customerId = ic.lastInsertRowid;

  const noKey = row.no_key ? 1 : 0;
  const result = await db.prepare(`
    INSERT INTO invoices (
      invoice_number, carpark_id, customer_id, account_customer_id, key_number, no_key,
      rego, first_name, last_name, phone, email,
      date_in, time_in, return_date, return_time, stay_nights,
      flight_info, flight_type, total_price, credit_applied, discount_percent,
      paid_status, payment_amount, payment_method, paid_status_2, payment_amount_2, payment_method_2,
      do_not_move, picked_up, staff_id, notes, customer_alert
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.invoice_number,
    CARPARK_ID,
    customerId,
    row.account_customer_id || null,
    row.key_number != null ? row.key_number : null,
    noKey,
    row.rego,
    row.first_name,
    row.last_name,
    row.phone,
    row.email || null,
    row.date_in,
    row.time_in,
    row.return_date,
    row.return_time,
    row.stay_nights,
    row.flight_info,
    row.flight_type || 'Standard - On Flight',
    row.total_price,
    row.credit_applied || 0,
    row.discount_percent || 0,
    row.paid_status,
    row.payment_amount || 0,
    row.payment_method || null,
    row.paid_status_2 || null,
    row.payment_amount_2 || 0,
    row.payment_method_2 || null,
    0,
    row.picked_up || 'Car In Yard',
    staffId,
    row.notes || null,
    row.customer_alert || null
  );

  const invoiceId = result.lastInsertRowid;
  await syncKeyBoxForPickedUp(db, CARPARK_ID, invoiceId, {
    key_number: row.key_number,
    no_key: noKey,
  }, row.picked_up || 'Car In Yard');
}

async function seedAccountCustomersReplace() {
  await db.prepare(`DELETE FROM account_customers WHERE carpark_id = ?`).run(CARPARK_ID);
  const ins = db.prepare(
    `INSERT INTO account_customers (company_name, contact_name, phone, email, billing_email, payment_link, discount_percent, notes, rego_1, rego_2, carpark_id, active)
     VALUES (?, ?, ?, ?, ?, '', ?, '', ?, ?, ?, 1)`
  );
  const rows = nzAccountCustomers();
  for (const r of rows) {
    await ins.run(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], CARPARK_ID);
  }
  console.log(`[seed] Inserted ${rows.length} on-account customers.`);
}

async function seedEmailLogs() {
  const accounts = await db.prepare(
    `SELECT id, company_name, billing_email FROM account_customers WHERE carpark_id = ? AND active = 1 ORDER BY id`
  ).all(CARPARK_ID);
  if (!accounts.length) return;

  const months = [
    [2, 2026], [3, 2026], [1, 2026], [12, 2025], [11, 2025],
    [3, 2026], [2, 2026], [3, 2026], [1, 2026], [3, 2026],
    [2, 2026], [3, 2026], [2, 2026], [3, 2026], [1, 2026],
  ];
  const statuses = ['sent', 'sent', 'sent', 'pending', 'failed', 'sent', 'sent', 'sent', 'pending', 'sent', 'sent', 'sent', 'sent', 'sent', 'sent'];

  let i = 0;
  for (const [month, year] of months) {
    const acct = accounts[i % accounts.length];
    const st = statuses[i] || 'sent';
    const recipient = acct.billing_email || acct.company_name + '@example.co.nz';
    if (st === 'failed') {
      await db.prepare(
        `INSERT INTO email_logs (carpark_id, account_customer_id, account_name, month, year, status, error_msg, recipient_email)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        CARPARK_ID,
        acct.id,
        acct.company_name,
        month,
        year,
        'failed',
        'SMTP timeout — retry scheduled',
        recipient
      );
    } else if (st === 'pending') {
      await db.prepare(
        `INSERT INTO email_logs (carpark_id, account_customer_id, account_name, month, year, status, error_msg, recipient_email)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(CARPARK_ID, acct.id, acct.company_name, month, year, 'pending', null, recipient);
    } else {
      await db.prepare(
        `INSERT INTO email_logs (carpark_id, account_customer_id, account_name, month, year, sent_at, status, recipient_email)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`
      ).run(CARPARK_ID, acct.id, acct.company_name, month, year, 'sent', recipient);
    }
    i++;
  }
  console.log(`[seed] Inserted ${months.length} email log rows.`);
}

async function seedLongTermReplace() {
  await db.prepare(`DELETE FROM longterm_customers WHERE carpark_id = ?`).run(CARPARK_ID);
  const ins = db.prepare(`
    INSERT INTO longterm_customers
      (lt_number, name, rego_1, rego_2, phone, email, rate, rate_period, expiry_date, notes, carpark_id, active,
       contract_amount, payment_status, lt_key_slot, lt_in_yard)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'monthly', ?, ?, ?, 1, ?, ?, ?, ?)
  `);
  for (const lt of nzLongTermRows()) {
    await ins.run(
      lt.lt_number,
      lt.name,
      lt.rego_1,
      lt.rego_2,
      lt.phone,
      lt.email,
      lt.rate,
      lt.expiry_date,
      `Long-term bay — ${lt.lt_number}`,
      CARPARK_ID,
      lt.rate * 6,
      lt.payment_status,
      lt.lt_key_slot,
      lt.lt_in_yard
    );
  }
  console.log(`[seed] Inserted ${LT_COUNT} long-term customers (keys ${LT_KEY_START}–${LT_KEY_START + LT_COUNT - 1} in yard).`);
}

async function seedPettyCash(staffId) {
  const existing = await db.prepare(`SELECT COUNT(*) as n FROM petty_cash WHERE carpark_id = ?`).get(CARPARK_ID);
  if (existing && existing.n > 0) return;

  const lines = [
    ['2026-03-01', 'Countdown Kerikeri — bin liners & cleaning', 42.9, 'expense', 'Supplies'],
    ['2026-03-03', 'Z Energy Whangārei — diesel for yard ute', 118.5, 'expense', 'Fuel'],
    ['2026-03-05', 'Far North IT — router spare part', 89.0, 'expense', 'Repairs'],
    ['2026-03-07', 'Refund — customer key deposit', 20.0, 'income', 'Other'],
    ['2026-03-09', 'Bunnings — padlocks', 34.95, 'expense', 'Supplies'],
  ];
  const ins = db.prepare(
    `INSERT INTO petty_cash (carpark_id, date, description, amount, type, category, staff_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const [d, desc, amt, typ, cat] of lines) {
    await ins.run(CARPARK_ID, d, desc, amt, typ, cat, staffId);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const replace = argv.includes('--replace');

  if (replace) {
    console.warn(
      '[seed] If `npm run dev` is running, stop it first — otherwise the app may overwrite carpark.db from stale memory after this script exits.'
    );
  }

  await initializeDatabase();

  const staffRow = await db.prepare(`SELECT id FROM users WHERE active = 1 ORDER BY id LIMIT 1`).get();
  const staffId = staffRow && staffRow.id != null ? staffRow.id : 1;

  const returnsYmd = businessDateYmd();

  if (replace) {
    await db.prepare(`DELETE FROM invoices WHERE carpark_id = ?`).run(CARPARK_ID);
    await db.prepare(`DELETE FROM customers WHERE carpark_id = ?`).run(CARPARK_ID);
    await db.prepare(`DELETE FROM email_logs WHERE carpark_id = ?`).run(CARPARK_ID);
    await db.prepare(
      `UPDATE key_box SET status='available', invoice_id=NULL, longterm_customer_id=NULL, holder_type='available' WHERE carpark_id = ?`
    ).run(CARPARK_ID);
    await db.prepare(`DELETE FROM petty_cash WHERE carpark_id = ?`).run(CARPARK_ID);

    await seedAccountCustomersReplace();
    await seedLongTermReplace();

    const rows = nzInvoiceRows(returnsYmd);
    for (const row of rows) {
      await insertInvoiceWithCustomer(row, staffId);
    }

    await seedEmailLogs();
    await seedPettyCash(staffId);

    console.log(`[seed] Returns screen (date=${returnsYmd}): ${RETURNS_COUNT} invoices with that return_date.`);
    console.log(`[seed] Done: ${TARGET_INVOICES} invoices (keys 1–${TARGET_INVOICES}), ${LT_COUNT} LT keys (${LT_KEY_START}–${LT_KEY_START + LT_COUNT - 1}).`);

    const report = await getNzSeedReport();
    const pass = reportPasses(report);
    console.log('[seed] Self-check (same process):', JSON.stringify({ ...report, pass }, null, 2));
    if (!pass) process.exit(1);
  } else {
    const countRow = await db.prepare(`SELECT COUNT(*) as n FROM invoices WHERE carpark_id = ? AND void = 0`).get(CARPARK_ID);
    const current = countRow ? countRow.n : 0;
    if (current >= TARGET_INVOICES) {
      console.log(`[seed] Already have ${current} invoices. Use --replace for full 31+8 demo.`);
      return;
    }
    const rows = nzInvoiceRows(returnsYmd);
    const maxInv = await db.prepare(`SELECT MAX(invoice_number) as m FROM invoices WHERE carpark_id = ?`).get(CARPARK_ID);
    let nextNum = (maxInv && maxInv.m != null ? maxInv.m : 19499) + 1;
    const need = TARGET_INVOICES - current;
    for (let j = 0; j < need && j < rows.length; j++) {
      await insertInvoiceWithCustomer({ ...rows[j], invoice_number: nextNum++ }, staffId);
    }
    await seedPettyCash(staffId);
  }

}

main().catch((e) => {
  console.error('[seed]', e);
  process.exit(1);
});
