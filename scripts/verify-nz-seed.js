/**
 * Read-only verification: does the DB match expected demo counts?
 * Does NOT insert. Exit 0 = pass, 1 = fail.
 *
 *   node scripts/verify-nz-seed.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { db, initializeDatabase } = require('../src/database');
const { businessDateYmd } = require('../src/utils/businessDate');

const CARPARK_ID = 1;

/** Same-process counts (use after seed while DB module still holds fresh data). */
async function getNzSeedReport() {
  const returnsYmd = businessDateYmd();

  const keysInUse = await db.prepare(
    `SELECT COUNT(*) as n FROM key_box WHERE carpark_id = ? AND status = 'in_use'`
  ).get(CARPARK_ID);
  const ltInYard = await db.prepare(
    `SELECT COUNT(*) as n FROM longterm_customers WHERE carpark_id = ? AND active = 1 AND lt_key_slot IS NOT NULL AND lt_in_yard = 1`
  ).get(CARPARK_ID);
  const invoices = await db.prepare(
    `SELECT COUNT(*) as n FROM invoices WHERE carpark_id = ? AND void = 0`
  ).get(CARPARK_ID);
  const returnsToday = await db.prepare(
    `SELECT COUNT(*) as n FROM invoices WHERE carpark_id = ? AND void = 0 AND DATE(return_date) = ?`
  ).get(CARPARK_ID, returnsYmd);
  const emailLogs = await db.prepare(`SELECT COUNT(*) as n FROM email_logs WHERE carpark_id = ?`).get(CARPARK_ID);
  const accounts = await db.prepare(
    `SELECT COUNT(*) as n FROM account_customers WHERE carpark_id = ? AND active = 1`
  ).get(CARPARK_ID);

  return {
    keys_in_use_standard: keysInUse ? keysInUse.n : 0,
    lt_in_yard: ltInYard ? ltInYard.n : 0,
    total_in_use_keys: (keysInUse ? keysInUse.n : 0) + (ltInYard ? ltInYard.n : 0),
    invoices_non_void: invoices ? invoices.n : 0,
    returns_on_business_date: returnsToday ? returnsToday.n : 0,
    business_date_used: returnsYmd,
    email_logs: emailLogs ? emailLogs.n : 0,
    account_customers: accounts ? accounts.n : 0,
  };
}

function reportPasses(report) {
  return (
    report.keys_in_use_standard === 31 &&
    report.lt_in_yard === 8 &&
    report.invoices_non_void === 31 &&
    report.returns_on_business_date >= 5 &&
    report.email_logs >= 10 &&
    report.account_customers >= 10
  );
}

async function cli() {
  await initializeDatabase();
  const report = await getNzSeedReport();
  const pass = reportPasses(report);
  console.log(JSON.stringify({ ...report, pass }, null, 2));
  if (!pass) {
    console.error(
      '[verify] FAIL — if npm run dev is running, it may overwrite carpark.db from stale memory. Stop the server and re-run: npm run seed:nz && npm run verify:nz'
    );
  }
  process.exit(pass ? 0 : 1);
}

if (require.main === module) {
  cli().catch((e) => {
    console.error('[verify]', e);
    process.exit(1);
  });
}

module.exports = { getNzSeedReport, reportPasses };
