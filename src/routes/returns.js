const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET /api/returns - Get car returns for a date
router.get('/', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { date, filter, search, search_type, show_voided } = req.query;
  const filterDate = date || new Date().toISOString().split('T')[0];

  let dateField = 'return_date';
  if (filter === 'date_brought_in') dateField = 'date_in';
  else if (filter === 'date_paid') dateField = 'updated_at';

  let query = `
    SELECT i.*, u.name as staff_name, ac.company_name as account_name
    FROM invoices i
    LEFT JOIN users u ON i.staff_id = u.id
    LEFT JOIN account_customers ac ON i.account_customer_id = ac.id
    WHERE i.carpark_id = ? AND DATE(i.${dateField}) = ?
  `;
  const params = [carparkId, filterDate];

  if (show_voided !== 'true') {
    query += ' AND i.void = 0';
  }

  if (search && search.trim()) {
    const s = `%${search.trim()}%`;
    if (search_type === 'name') {
      query += ` AND (i.last_name LIKE ? OR i.first_name LIKE ?)`;
      params.push(s, s);
    } else if (search_type === 'rego') {
      query += ` AND i.rego LIKE ?`;
      params.push(s);
    } else {
      // Invoice number
      query += ` AND CAST(i.invoice_number AS TEXT) LIKE ?`;
      params.push(s);
    }
  }

  query += ' ORDER BY i.return_time ASC, i.id ASC';

  const invoices = db.prepare(query).all(...params);

  // Group by return time
  const groups = {};
  const overdue = [];

  invoices.forEach(inv => {
    if (!inv.return_date || inv.return_date < filterDate) {
      overdue.push(inv);
    } else {
      const timeKey = inv.return_time || 'Unspecified';
      if (!groups[timeKey]) groups[timeKey] = [];
      groups[timeKey].push(inv);
    }
  });

  res.json({
    date: filterDate,
    total: invoices.length,
    groups,
    overdue,
    overdueCars: overdue.length
  });
});

// POST /api/returns/:id/pickup - Mark car as picked up
router.post('/:id/pickup', requireAuth, (req, res) => {
  const { id } = req.params;
  const { picked_up } = req.body;
  const carparkId = req.session.carparkId || 1;

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND carpark_id = ?').get(id, carparkId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  db.prepare("UPDATE invoices SET picked_up = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(picked_up || 'Picked Up', id);

  // Release key
  if (invoice.key_number && picked_up !== 'Car In Yard') {
    db.prepare("UPDATE key_box SET status = 'available', invoice_id = NULL WHERE carpark_id = ? AND key_number = ?")
      .run(carparkId, invoice.key_number);
  }

  res.json({ success: true });
});

module.exports = router;
