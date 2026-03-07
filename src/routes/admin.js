const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const router = express.Router();

router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await db.prepare('SELECT id, username, name, email, role, active, created_at FROM users WHERE carpark_id = ?').all(req.session.carparkId || 1);
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const { username, password, name, email, role } = req.body;
    const existing = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return res.status(400).json({ error: 'Username already exists' });
    const hash = bcrypt.hashSync(password, 10);
    const result = await db.prepare(`INSERT INTO users (username, password, name, email, role, carpark_id) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(username, hash, name, email, role || 'staff', carparkId);
    const user = await db.prepare('SELECT id, username, name, email, role, active FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, email, role, active, password } = req.body;
    if (password) {
      const hash = bcrypt.hashSync(password, 10);
      await db.prepare('UPDATE users SET name=?, email=?, role=?, active=?, password=? WHERE id=?').run(name, email, role, active ? 1 : 0, hash, req.params.id);
    } else {
      await db.prepare('UPDATE users SET name=?, email=?, role=?, active=? WHERE id=?').run(name, email, role, active ? 1 : 0, req.params.id);
    }
    const user = await db.prepare('SELECT id, username, name, email, role, active FROM users WHERE id = ?').get(req.params.id);
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/carparks', requireAuth, requireAdmin, async (req, res) => {
  try {
    const carparks = await db.prepare('SELECT * FROM carparks').all();
    res.json(carparks);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/carparks/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, address, phone, email, capacity } = req.body;
    await db.prepare('UPDATE carparks SET name=?, address=?, phone=?, email=?, capacity=? WHERE id=?').run(name, address, phone, email, capacity, req.params.id);
    const carpark = await db.prepare('SELECT * FROM carparks WHERE id = ?').get(req.params.id);
    res.json(carpark);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/pricing', requireAuth, requireAdmin, async (req, res) => {
  try {
    const rules = await db.prepare('SELECT * FROM pricing_rules WHERE carpark_id = ? ORDER BY customer_type, days_from').all(req.session.carparkId || 1);
    res.json(rules);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/pricing', requireAuth, requireAdmin, async (req, res) => {
  try {
    const carparkId = req.session.carparkId || 1;
    const { customer_type, days_from, days_to, daily_rate, description } = req.body;
    const result = await db.prepare(`INSERT INTO pricing_rules (carpark_id, customer_type, days_from, days_to, daily_rate, description) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(carparkId, customer_type, days_from, days_to || null, daily_rate, description);
    const rule = await db.prepare('SELECT * FROM pricing_rules WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(rule);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/pricing/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { days_from, days_to, daily_rate, description, active } = req.body;
    await db.prepare('UPDATE pricing_rules SET days_from=?, days_to=?, daily_rate=?, description=?, active=? WHERE id=?')
      .run(days_from, days_to || null, daily_rate, description, active ? 1 : 0, req.params.id);
    const rule = await db.prepare('SELECT * FROM pricing_rules WHERE id = ?').get(req.params.id);
    res.json(rule);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/pricing/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.prepare('DELETE FROM pricing_rules WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/staff-list', requireAuth, async (req, res) => {
  try {
    const staff = await db.prepare('SELECT id, name FROM users WHERE carpark_id = ? AND active = 1 ORDER BY name').all(req.session.carparkId || 1);
    res.json(staff);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!bcrypt.compareSync(current_password, user.password)) return res.status(400).json({ error: 'Current password is incorrect' });
    const hash = bcrypt.hashSync(new_password, 10);
    await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.session.userId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
