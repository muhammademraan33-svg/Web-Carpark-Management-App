/**
 * GET /api/flights/arrivals?date=YYYY-MM-DD
 *
 * Proxies live arrival data from Air New Zealand's internal API for
 * Kerikeri / Bay of Islands Airport (KKE).
 *
 * Falls back to a static schedule if the Air NZ API is unreachable.
 */

const express = require('express');
const https   = require('https');
const router  = express.Router();

// ─── Simple in-memory cache (per date) ───────────────────────────────────────
const _cache = {};          // { 'YYYY-MM-DD': { ts, flights } }
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Static fallback schedule (day 0=Sun … 6=Sat) ────────────────────────────
const FALLBACK = {
  0: [{ flight:'NZ',time:'10:25',label:'Morning'  },{ flight:'NZ',time:'13:25',label:'Midday'   },{ flight:'NZ',time:'16:25',label:'Afternoon'},{ flight:'NZ',time:'18:55',label:'Evening'  }],
  1: [{ flight:'NZ',time:'12:15',label:'Morning'  },{ flight:'NZ',time:'14:35',label:'Midday'   },{ flight:'NZ',time:'17:05',label:'Afternoon'},{ flight:'NZ',time:'20:30',label:'Evening'  }],
  2: [{ flight:'NZ',time:'12:15',label:'Morning'  },{ flight:'NZ',time:'14:35',label:'Midday'   },{ flight:'NZ',time:'17:05',label:'Afternoon'},{ flight:'NZ',time:'20:30',label:'Evening'  }],
  3: [{ flight:'NZ',time:'12:15',label:'Morning'  },{ flight:'NZ',time:'14:35',label:'Midday'   },{ flight:'NZ',time:'17:05',label:'Afternoon'},{ flight:'NZ',time:'20:30',label:'Evening'  }],
  4: [{ flight:'NZ',time:'12:15',label:'Morning'  },{ flight:'NZ',time:'14:35',label:'Midday'   },{ flight:'NZ',time:'17:05',label:'Afternoon'},{ flight:'NZ',time:'20:30',label:'Evening'  }],
  5: [{ flight:'NZ',time:'12:15',label:'Morning'  },{ flight:'NZ',time:'14:35',label:'Midday'   },{ flight:'NZ',time:'17:05',label:'Afternoon'},{ flight:'NZ',time:'20:30',label:'Evening'  }],
  6: [{ flight:'NZ',time:'09:55',label:'Morning'  },{ flight:'NZ',time:'13:00',label:'Midday'   },{ flight:'NZ',time:'16:00',label:'Afternoon'},{ flight:'NZ',time:'18:30',label:'Late afternoon'}],
};

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':     'application/json',
      }
    }, (res) => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('JSON parse failed')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// GET /api/flights/arrivals?date=YYYY-MM-DD
router.get('/arrivals', async (req, res) => {
  let { date } = req.query;

  // Default to today's NZ date
  if (!date) {
    date = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' });
  }

  const parts = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return res.status(400).json({ error: 'Invalid date – use YYYY-MM-DD' });

  const dow = new Date(Date.UTC(+parts[1], +parts[2]-1, +parts[3], 12)).getUTCDay();

  // Return cached result if fresh
  if (_cache[date] && (Date.now() - _cache[date].ts) < CACHE_TTL_MS) {
    return res.json({ date, dayOfWeek: dow, flights: _cache[date].flights });
  }

  try {
    const url = `https://www.airnewzealand.co.nz/api/v3/flight-status?direction=arrivals&airport=KKE&locale=en_NZ&date=${date}`;
    const data = await fetchJson(url);

    if (!Array.isArray(data)) throw new Error('unexpected response');

    const flights = data.map(f => ({
      flight: `NZ${f.flightDesignator.flightNumber}`,
      time:   f.arrival.scheduled.time24,
      label:  f.arrival.scheduled.time12,
      status: f.status || 'scheduled',
      origin: f.scheduledOrigin?.name || 'Auckland',
    }));

    _cache[date] = { ts: Date.now(), flights };
    res.json({ date, dayOfWeek: dow, flights, live: true });

  } catch (err) {
    // Fallback to static schedule
    console.warn('[flights] Air NZ API failed, using fallback:', err.message);
    const flights = (FALLBACK[dow] || FALLBACK[1]);
    res.json({ date, dayOfWeek: dow, flights, live: false });
  }
});

module.exports = router;
