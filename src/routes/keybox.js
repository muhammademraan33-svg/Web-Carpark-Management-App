const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { releaseKey } = require('../utils/keyBoxSync');
const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const keys = await db.prepare(`
      SELECT k.*, i.invoice_number, i.first_name, i.last_name, i.rego, i.return_date,
             lt.lt_number, lt.name as lt_name, lt.rego_1 as lt_rego_1, lt.rego_2 as lt_rego_2
      FROM key_box k
      LEFT JOIN invoices i ON k.invoice_id = i.id AND i.void = 0
      LEFT JOIN longterm_customers lt ON k.longterm_customer_id = lt.id
      WHERE k.carpark_id = ?
      ORDER BY k.key_number
    `).all(carparkId);
    const available = keys.filter(k => k.status === 'available').length;
    const inUse     = keys.filter(k => k.status === 'in_use').length;
    res.json({ keys, available, inUse, total: keys.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/available', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const keys = await db.prepare("SELECT key_number FROM key_box WHERE carpark_id = ? AND status = 'available' ORDER BY key_number").all(carparkId);
    res.json(keys.map(k => k.key_number));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:key_number/release', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    await releaseKey(db, carparkId, req.params.key_number);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/add', requireAuth, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const { key_number } = req.body;
    const existing = await db.prepare('SELECT id FROM key_box WHERE carpark_id = ? AND key_number = ?').get(carparkId, key_number);
    if (existing) return res.status(400).json({ error: 'Key number already exists' });
    await db.prepare('INSERT INTO key_box (carpark_id, key_number, status) VALUES (?, ?, ?)').run(carparkId, key_number, 'available');
    res.json({ success: true, key_number });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
