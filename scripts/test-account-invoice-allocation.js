#!/usr/bin/env node
/**
 * Validates account payments allocated to specific invoices.
 * Run: node scripts/test-account-invoice-allocation.js
 */
(async () => {
  const { db, initializeDatabase } = require('../src/database');
  await initializeDatabase();
  const carparkId = 1;
  const tag = Date.now();

  const ac = await db.prepare(`INSERT INTO account_customers (company_name, carpark_id, active) VALUES (?, ?, 1)`)
    .run(`ALLOC-TEST-${tag}`, carparkId);
  const aid = ac.lastInsertRowid;

  const inv1 = await db.prepare(`
    INSERT INTO invoices (invoice_number, carpark_id, account_customer_id, first_name, last_name, rego, date_in, total_price, paid_status, void)
    VALUES (?, ?, ?, 'A','One', 'ABC123', '2026-03-05', 100.00, 'OnAcc', 0)
  `).run(900000 + (tag % 100000), carparkId, aid);

  const inv2 = await db.prepare(`
    INSERT INTO invoices (invoice_number, carpark_id, account_customer_id, first_name, last_name, rego, date_in, total_price, paid_status, void)
    VALUES (?, ?, ?, 'B','Two', 'XYZ999', '2026-03-12', 50.00, 'OnAcc', 0)
  `).run(900001 + (tag % 100000), carparkId, aid);

  const iid1 = inv1.lastInsertRowid;
  const iid2 = inv2.lastInsertRowid;

  // Pay invoice 1 only — payment received in April but applies to March invoice 1
  await db.prepare(`
    INSERT INTO account_payments (carpark_id, account_customer_id, invoice_id, payment_date, amount, payment_method)
    VALUES (?, ?, ?, '2026-04-10', 60.00, 'Internet Bank')
  `).run(carparkId, aid, iid1);

  const paid1 = await db.prepare(`SELECT COALESCE(SUM(amount),0) AS p FROM account_payments WHERE invoice_id = ?`).get(iid1);
  if (Math.abs(paid1.p - 60) > 0.01) {
    console.error('FAIL invoice 1 paid', paid1.p);
    process.exit(1);
  }

  // March month outstanding should be 90 (150 invoiced - 60 paid on inv1), not 150 (old payment_date logic)
  const monthStart = '2026-03-01';
  const monthEnd = '2026-03-31';
  const monthRow = await db.prepare(`
    SELECT
      (SELECT COALESCE(SUM(COALESCE(i.total_price,0)),0) FROM invoices i
       WHERE i.account_customer_id = ? AND i.carpark_id = ? AND i.void = 0
       AND substr(trim(COALESCE(i.date_in,'')),1,10) >= ? AND substr(trim(COALESCE(i.date_in,'')),1,10) <= ?) AS billed,
      (SELECT COALESCE(SUM(p.amount), 0) FROM account_payments p
       INNER JOIN invoices i ON i.id = p.invoice_id AND i.void = 0
       WHERE p.account_customer_id = ? AND p.carpark_id = ?
         AND substr(trim(COALESCE(i.date_in,'')), 1, 10) >= ? AND substr(trim(COALESCE(i.date_in,'')), 1, 10) <= ?) AS paid_by_invoice
  `).get(aid, carparkId, monthStart, monthEnd, aid, carparkId, monthStart, monthEnd);

  const out = Math.round(((monthRow.billed || 0) - (monthRow.paid_by_invoice || 0)) * 100) / 100;
  if (Math.abs(out - 90) > 0.02) {
    console.error('FAIL march outstanding expected 90 got', out, monthRow);
    process.exit(1);
  }

  // Invoice 2 still fully outstanding
  const paid2 = await db.prepare(`SELECT COALESCE(SUM(amount),0) AS p FROM account_payments WHERE invoice_id = ?`).get(iid2);
  if (paid2.p !== 0) {
    console.error('FAIL invoice 2 should be unpaid');
    process.exit(1);
  }

  await db.prepare(`DELETE FROM account_payments WHERE account_customer_id = ?`).run(aid);
  await db.prepare(`DELETE FROM invoices WHERE account_customer_id = ?`).run(aid);
  await db.prepare(`DELETE FROM account_customers WHERE id = ?`).run(aid);

  console.log('PASS account invoice allocation');
  process.exit(0);
})();
