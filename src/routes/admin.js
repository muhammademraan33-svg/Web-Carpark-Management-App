const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const router = express.Router();

// GET /api/admin/users
router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const users = db.prepare('SELECT id, username, name, email, role, active, created_at FROM users WHERE carpark_id = ?').all(carparkId);
  res.json(users);
});

// POST /api/admin/users
router.post('/users', requireAuth, requireAdmin, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { username, password, name, email, role } = req.body;
  
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(400).json({ error: 'Username already exists' });
  
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(`
    INSERT INTO users (username, password, name, email, role, carpark_id) VALUES (?, ?, ?, ?, ?, ?)
  `).run(username, hash, name, email, role || 'staff', carparkId);
  
  const user = db.prepare('SELECT id, username, name, email, role, active FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(user);
});

// PUT /api/admin/users/:id
router.put('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const { name, email, role, active, password } = req.body;
  
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET name=?, email=?, role=?, active=?, password=? WHERE id=?')
      .run(name, email, role, active ? 1 : 0, hash, req.params.id);
  } else {
    db.prepare('UPDATE users SET name=?, email=?, role=?, active=? WHERE id=?')
      .run(name, email, role, active ? 1 : 0, req.params.id);
  }
  
  const user = db.prepare('SELECT id, username, name, email, role, active FROM users WHERE id = ?').get(req.params.id);
  res.json(user);
});

// GET /api/admin/carparks
router.get('/carparks', requireAuth, requireAdmin, (req, res) => {
  const carparks = db.prepare('SELECT * FROM carparks').all();
  res.json(carparks);
});

// PUT /api/admin/carparks/:id
router.put('/carparks/:id', requireAuth, requireAdmin, (req, res) => {
  const { name, address, phone, email, capacity } = req.body;
  db.prepare('UPDATE carparks SET name=?, address=?, phone=?, email=?, capacity=? WHERE id=?')
    .run(name, address, phone, email, capacity, req.params.id);
  const carpark = db.prepare('SELECT * FROM carparks WHERE id = ?').get(req.params.id);
  res.json(carpark);
});

// GET /api/admin/pricing
router.get('/pricing', requireAuth, requireAdmin, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const rules = db.prepare('SELECT * FROM pricing_rules WHERE carpark_id = ? ORDER BY customer_type, days_from').all(carparkId);
  res.json(rules);
});

// POST /api/admin/pricing
router.post('/pricing', requireAuth, requireAdmin, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const { customer_type, days_from, days_to, daily_rate, description } = req.body;
  const result = db.prepare(`
    INSERT INTO pricing_rules (carpark_id, customer_type, days_from, days_to, daily_rate, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(carparkId, customer_type, days_from, days_to || null, daily_rate, description);
  const rule = db.prepare('SELECT * FROM pricing_rules WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(rule);
});

// PUT /api/admin/pricing/:id
router.put('/pricing/:id', requireAuth, requireAdmin, (req, res) => {
  const { days_from, days_to, daily_rate, description, active } = req.body;
  db.prepare('UPDATE pricing_rules SET days_from=?, days_to=?, daily_rate=?, description=?, active=? WHERE id=?')
    .run(days_from, days_to || null, daily_rate, description, active ? 1 : 0, req.params.id);
  const rule = db.prepare('SELECT * FROM pricing_rules WHERE id = ?').get(req.params.id);
  res.json(rule);
});

// DELETE /api/admin/pricing/:id
router.delete('/pricing/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM pricing_rules WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET /api/admin/staff-list - Get staff for dropdowns (all auth users)
router.get('/staff-list', requireAuth, (req, res) => {
  const carparkId = req.session.carparkId || 1;
  const staff = db.prepare('SELECT id, name FROM users WHERE carpark_id = ? AND active = 1 ORDER BY name').all(carparkId);
  res.json(staff);
});

// POST /api/admin/change-password - Change own password
router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  
  if (!bcrypt.compareSync(current_password, user.password)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.session.userId);
  res.json({ success: true });
});

module.exports = router;
