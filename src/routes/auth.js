const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../database');
const router = express.Router();

const JWT_SECRET  = () => process.env.SESSION_SECRET || 'carpark_secret_2026';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 8 * 60 * 60 * 1000,
  secure: process.env.NODE_ENV === 'production'  // Required for HTTPS (Railway)
};

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = await db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid username or password' });

  const token = jwt.sign(
    { userId: user.id, username: user.username, name: user.name, role: user.role, carparkId: user.carpark_id },
    JWT_SECRET(),
    { expiresIn: '8h' }
  );
  res.cookie('auth_token', token, COOKIE_OPTS);
  res.json({ success: true, user: { id: user.id, username: user.username, name: user.name, role: user.role, carparkId: user.carpark_id } });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('auth_token', { httpOnly: true, sameSite: 'lax' });
  req.session = {};
  res.json({ success: true });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ id: req.session.userId, username: req.session.username, name: req.session.name, role: req.session.role, carparkId: req.session.carparkId });
});

module.exports = router;
