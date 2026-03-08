/**
 * GET /api/flights/arrivals?date=YYYY-MM-DD
 *
 * Returns Air New Zealand arrival times at Kerikeri / Bay of Islands
 * Airport (KKE) for the requested date.
 *
 * Schedule source: Air New Zealand published timetable for the
 * Auckland (AKL) → Kerikeri (KKE) route (NZ839x services).
 * Flight time AKL → KKE is approximately 45–55 minutes.
 *
 * Update these times whenever Air NZ publishes a new timetable season.
 */

const express = require('express');
const router  = express.Router();

// ─── Published arrival times at Kerikeri (KKE) ────────────────────────────────
// day 0 = Sunday … 6 = Saturday
// Times are NZ LOCAL time (NZST/NZDT) – i.e. what the clock shows at the airport.
const SCHEDULE = {
  // Monday
  1: [
    { flight: 'NZ8391', time: '09:40', label: 'Morning' },
    { flight: 'NZ8393', time: '12:40', label: 'Midday' },
    { flight: 'NZ8395', time: '15:35', label: 'Afternoon' },
    { flight: 'NZ8397', time: '17:35', label: 'Late afternoon' },
    { flight: 'NZ8399', time: '20:05', label: 'Evening' },
  ],
  // Tuesday
  2: [
    { flight: 'NZ8391', time: '09:40', label: 'Morning' },
    { flight: 'NZ8393', time: '12:40', label: 'Midday' },
    { flight: 'NZ8395', time: '15:35', label: 'Afternoon' },
    { flight: 'NZ8397', time: '17:35', label: 'Late afternoon' },
    { flight: 'NZ8399', time: '20:05', label: 'Evening' },
  ],
  // Wednesday
  3: [
    { flight: 'NZ8391', time: '09:40', label: 'Morning' },
    { flight: 'NZ8393', time: '12:40', label: 'Midday' },
    { flight: 'NZ8395', time: '15:35', label: 'Afternoon' },
    { flight: 'NZ8397', time: '17:35', label: 'Late afternoon' },
    { flight: 'NZ8399', time: '20:05', label: 'Evening' },
  ],
  // Thursday
  4: [
    { flight: 'NZ8391', time: '09:40', label: 'Morning' },
    { flight: 'NZ8393', time: '12:40', label: 'Midday' },
    { flight: 'NZ8395', time: '15:35', label: 'Afternoon' },
    { flight: 'NZ8397', time: '17:35', label: 'Late afternoon' },
    { flight: 'NZ8399', time: '20:05', label: 'Evening' },
  ],
  // Friday
  5: [
    { flight: 'NZ8391', time: '09:40', label: 'Morning' },
    { flight: 'NZ8393', time: '12:40', label: 'Midday' },
    { flight: 'NZ8395', time: '15:35', label: 'Afternoon' },
    { flight: 'NZ8397', time: '17:35', label: 'Late afternoon' },
    { flight: 'NZ8399', time: '20:05', label: 'Evening' },
  ],
  // Saturday
  6: [
    { flight: 'NZ8391', time: '09:55', label: 'Morning' },
    { flight: 'NZ8393', time: '13:00', label: 'Midday' },
    { flight: 'NZ8395', time: '16:00', label: 'Afternoon' },
    { flight: 'NZ8397', time: '18:30', label: 'Late afternoon' },
  ],
  // Sunday
  0: [
    { flight: 'NZ8391', time: '10:25', label: 'Morning' },
    { flight: 'NZ8393', time: '13:25', label: 'Midday' },
    { flight: 'NZ8395', time: '16:25', label: 'Afternoon' },
    { flight: 'NZ8397', time: '18:55', label: 'Evening' },
  ],
};

// GET /api/flights/arrivals?date=YYYY-MM-DD
router.get('/arrivals', (req, res) => {
  let { date } = req.query;

  // Default to today's NZ date if not provided
  if (!date) {
    date = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' });
  }

  // Parse the date string directly (YYYY-MM-DD) to avoid any timezone offset
  // issues.  We treat the date as-is — we just need the day of week.
  const parts = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) {
    return res.status(400).json({ error: 'Invalid date – use YYYY-MM-DD' });
  }

  // Build a noon-UTC Date so getUTCDay() gives the day matching the calendar
  // date the user entered, independent of the server's local timezone.
  const d = new Date(Date.UTC(
    parseInt(parts[1]),
    parseInt(parts[2]) - 1,
    parseInt(parts[3]),
    12, 0, 0
  ));
  const dow = d.getUTCDay(); // 0 = Sunday … 6 = Saturday

  const flights = SCHEDULE[dow] || SCHEDULE[1]; // fallback: Monday
  res.json({ date, dayOfWeek: dow, flights });
});

module.exports = router;
