/** SQL fragment: invoice date_in as YYYY-MM-DD */
const INV_DAY = `substr(trim(COALESCE(i.date_in,'')), 1, 10)`;
const PAY_DAY = `substr(trim(COALESCE(p.payment_date,'')), 1, 10)`;

/** Sum paid against invoices whose date_in falls in [startDate, endDate]. */
const MONTH_PAID_BY_INVOICE = `
  (SELECT COALESCE(SUM(p.amount), 0) FROM account_payments p
   INNER JOIN invoices i ON i.id = p.invoice_id AND i.void = 0
   WHERE p.account_customer_id = a.id AND p.carpark_id = a.carpark_id
     AND ${INV_DAY} >= ? AND ${INV_DAY} <= ?)`;

/** Legacy/unallocated payments counted by payment_date in the month. */
const MONTH_PAID_UNALLOCATED = `
  (SELECT COALESCE(SUM(p.amount), 0) FROM account_payments p
   WHERE p.account_customer_id = a.id AND p.carpark_id = a.carpark_id
     AND p.invoice_id IS NULL
     AND ${PAY_DAY} >= ? AND ${PAY_DAY} <= ?)`;

module.exports = { INV_DAY, PAY_DAY, MONTH_PAID_BY_INVOICE, MONTH_PAID_UNALLOCATED };
