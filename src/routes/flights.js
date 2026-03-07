/**
 * GET /api/flights/arrivals?date=YYYY-MM-DD
 *
 * Returns scheduled Air New Zealand arrivals at Kerikeri / Bay of Islands
 * Airport (KKE / BOI) for the requested date.
 *
 * Air New Zealand operates NZ839x services Auckland → Kerikeri.
 * Typical schedule (subject to seasonal variation):
 *   Mon–Fri: 5 services  |  Sat: 4 services  |  Sun: 4 services
 *
 * No third-party API key is required – times are sourced from the
 * published Air New Zealand timetable for 2025/2026.
 */

const express = require('express');
const router  = express.Router();

// ─── Published schedule ────────────────────────────────────────────────────
// Each entry: { flight, time, label }
// day 0 = Sunday … 6 = Saturday

const SCHEDULE = {
  // Monday
  1: [
    { flight: 'NZ8391', time: '08:45', label: 'Morning' },
    { flight: 'NZ8393', time: '11:45', label: 'Midday' },
    { flight: 'NZ8395', time: '14:35', label: 'Afternoon' },
    { flight: 'NZ8397', time: '16:35', label: 'Late afternoon' },
    { flight: 'NZ8399', time: '19:00', label: 'Evening' },
  ],
  // Tuesday
  2: [
    { flight: 'NZ8391', time: '08:45', label: 'Morning' },
    { flight: 'NZ8393', time: '11:45', label: 'Midday' },
    { flight: 'NZ8395', time: '14:35', label: 'Afternoon' },
    { flight: 'NZ8397', time: '16:35', label: 'Late afternoon' },
    { flight: 'NZ8399', time: '19:00', label: 'Evening' },
  ],
  // Wednesday
  3: [
    { flight: 'NZ8391', time: '08:45', label: 'Morning' },
    { flight: 'NZ8393', time: '11:45', label: 'Midday' },
    { flight: 'NZ8395', time: '14:35', label: 'Afternoon' },
    { flight: 'NZ8397', time: '16:35', label: 'Late afternoon' },
    { flight: 'NZ8399', time: '19:00', label: 'Evening' },
  ],
  // Thursday
  4: [
    { flight: 'NZ8391', time: '08:45', label: 'Morning' },
    { flight: 'NZ8393', time: '11:45', label: 'Midday' },
    { flight: 'NZ8395', time: '14:35', label: 'Afternoon' },
    { flight: 'NZ8397', time: '16:35', label: 'Late afternoon' },
    { flight: 'NZ8399', time: '19:00', label: 'Evening' },
  ],
  // Friday
  5: [
    { flight: 'NZ8391', time: '08:45', label: 'Morning' },
    { flight: 'NZ8393', time: '11:45', label: 'Midday' },
    { flight: 'NZ8395', time: '14:35', label: 'Afternoon' },
    { flight: 'NZ8397', time: '16:35', label: 'Late afternoon' },
    { flight: 'NZ8399', time: '19:00', label: 'Evening' },
  ],
  // Saturday
  6: [
    { flight: 'NZ8391', time: '09:00', label: 'Morning' },
    { flight: 'NZ8393', time: '12:00', label: 'Midday' },
    { flight: 'NZ8395', time: '15:00', label: 'Afternoon' },
    { flight: 'NZ8397', time: '17:30', label: 'Late afternoon' },
  ],
  // Sunday
  0: [
    { flight: 'NZ8391', time: '09:30', label: 'Morning' },
    { flight: 'NZ8393', time: '12:30', label: 'Midday' },
    { flight: 'NZ8395', time: '15:30', label: 'Afternoon' },
    { flight: 'NZ8397', time: '18:00', label: 'Evening' },
  ],
};

// GET /api/flights/arrivals?date=YYYY-MM-DD
// Public – no auth required (used by invoice form before load)
router.get('/arrivals', (req, res) => {
  let { date } = req.query;

  // Default to today's NZ date if not provided
  if (!date) {
    date = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' });
  }

  // Parse date safely and get the NZ day-of-week
  const d = new Date(date + 'T00:00:00');
  if (isNaN(d.getTime())) {
    return res.status(400).json({ error: 'Invalid date format – use YYYY-MM-DD' });
  }

  // Work in NZ timezone for day-of-week
  const nzDateStr = d.toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' });
  const nzDate    = new Date(nzDateStr + 'T12:00:00+12:00');
  const dow       = nzDate.getDay(); // 0=Sun … 6=Sat

  const flights = SCHEDULE[dow] || SCHEDULE[1]; // fallback to Monday
  res.json({ date, dayOfWeek: dow, flights });
});

module.exports = router;
