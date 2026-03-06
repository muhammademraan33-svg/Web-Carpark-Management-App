const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET /api/keybox
router.get('/', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const keys = db.prepare(`
    SELECT k.*, i.invoice_number, i.first_name, i.last_name, i.rego, i.return_date
    FROM key_box k
    LEFT JOIN invoices i ON k.invoice_id = i.id AND i.void = 0
    WHERE k.carpark_id = ?
    ORDER BY k.key_number
  `).all(carparkId);
  
  const available = keys.filter(k => k.status === 'available').length;
  const inUse = keys.filter(k => k.status === 'in_use').length;
  
  res.json({ keys, available, inUse, total: keys.length });
});

// GET /api/keybox/available
router.get('/available', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const keys = db.prepare("SELECT key_number FROM key_box WHERE carpark_id = ? AND status = 'available' ORDER BY key_number").all(carparkId);
  res.json(keys.map(k => k.key_number));
});

// POST /api/keybox/:key_number/release
router.post('/:key_number/release', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { key_number } = req.params;
  db.prepare("UPDATE key_box SET status = 'available', invoice_id = NULL WHERE carpark_id = ? AND key_number = ?")
    .run(carparkId, key_number);
  res.json({ success: true });
});

// POST /api/keybox/add - Add new key
router.post('/add', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { key_number } = req.body;
  
  const existing = db.prepare('SELECT id FROM key_box WHERE carpark_id = ? AND key_number = ?').get(carparkId, key_number);
  if (existing) return res.status(400).json({ error: 'Key number already exists' });
  
  db.prepare('INSERT INTO key_box (carpark_id, key_number, status) VALUES (?, ?, ?)').run(carparkId, key_number, 'available');
  res.json({ success: true, key_number });
});

module.exports = router;
