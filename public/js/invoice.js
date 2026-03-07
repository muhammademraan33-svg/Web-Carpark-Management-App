// === Invoice Page JS ===
document.getElementById('navbar-container').innerHTML = renderNavbar('invoice');

let currentInvoiceId = null;
let staffList = [];
let accountCustomers = [];
let _saving = false; // guard against concurrent saves / race conditions

// ─── Customer alert helpers (robust if elements missing) ──────────────────────
function getCustomerAlertElement() {
  return document.getElementById('customer-alert-text');
}

function getCustomerAlertDisplay() {
  return document.getElementById('customer-alert-display');
}

function getCustomerAlertText() {
  const el = getCustomerAlertElement();
  return el ? (el.textContent || '') : '';
}

function setCustomerAlertText(text) {
  const el = getCustomerAlertElement();
  const box = getCustomerAlertDisplay();
  if (!el || !box) return; // fail-safe if HTML is out of sync
  el.textContent = text || '';
  box.classList.toggle('d-none', !text);
}

async function initInvoicePage() {
  const user = await checkAuth();
  if (!user) return;

  // Load staff list
  const staffRes = await fetch('/api/admin/staff-list');
  if (staffRes.ok) {
    staffList = await staffRes.json();
    const staffSel = document.getElementById('inv-staff');
    staffList.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      if (s.id === user.id) opt.selected = true;
      staffSel.appendChild(opt);
    });
  }

  // Load account customers
  const acctRes = await fetch('/api/accounts');
  if (acctRes.ok) {
    accountCustomers = await acctRes.json();
    const acctSel = document.getElementById('inv-account-customer');
    accountCustomers.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.company_name;
      acctSel.appendChild(opt);
    });
  }

  // Load available keys and auto-select the lowest available one
  const keyRes = await fetch('/api/keybox/available');
  if (keyRes.ok) {
    const keys = await keyRes.json();
    const keySel = document.getElementById('inv-key-number');
    keys.forEach(k => {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = `Key ${k}`;
      keySel.appendChild(opt);
    });
    // Auto-select first available key for new invoices
    if (keys.length > 0 && !new URLSearchParams(window.location.search).get('id')) {
      keySel.value = keys[0];
    }
  }

  // Check URL params for loading existing invoice
  const params = new URLSearchParams(window.location.search);
  if (params.get('id')) {
    await loadInvoice(null, params.get('id'));
  } else {
    await newInvoice();
  }

  updateNavCarsCount();
  // Load today's flights for the default return date
  loadFlightsForDate(document.getElementById('inv-return-date').value);
}

async function newInvoice() {
  // Get next invoice number
  const res = await fetch('/api/invoices/next-number');
  if (res.ok) {
    const data = await res.json();
    document.getElementById('inv-number-display').textContent = data.invoiceNumber;
    document.getElementById('inv-load-number').value = '';
  }

  // Clear form
  currentInvoiceId = null;
  document.getElementById('inv-id').value = '';
  document.getElementById('inv-customer-id').value = '';
  document.getElementById('inv-rego').value = '';
  document.getElementById('inv-last-name').value = '';
  document.getElementById('inv-first-name').value = '';
  document.getElementById('inv-phone').value = '';
  document.getElementById('inv-email').value = '';
  document.getElementById('inv-notes').value = '';
  document.getElementById('inv-flight-info').value = '';
  document.getElementById('inv-total-price').value = '';
  document.getElementById('inv-payment-amount').value = '';
  document.getElementById('inv-payment-amount-2').value = '';
  document.getElementById('inv-paid-status').value = 'To Pay';
  document.getElementById('inv-paid-status-2').value = '';
  document.getElementById('inv-do-not-move').checked = false;
  document.getElementById('inv-picked-up').value = 'Car In Yard';
  document.getElementById('inv-discount-10').checked = false;
  document.getElementById('inv-account-customer').value = '';
  document.getElementById('price-breakdown').textContent = '';
  // Clear any existing customer alert (if the alert elements exist)
  setCustomerAlertText('');

  // Set default dates
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  document.getElementById('inv-date-in').value = todayStr;
  document.getElementById('inv-time-in').value = now.toTimeString().substr(0, 5);
  // Default return: tomorrow
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  document.getElementById('inv-return-date').value = tomorrow.toISOString().split('T')[0];
  document.getElementById('inv-return-time').value = '14:35';

  updateNightsAndDisplay();
  document.getElementById('inv-status-badge').innerHTML = `<span class="badge bg-warning text-dark">UNSAVED</span>`;
  const _sbt = document.getElementById('save-btn-text');
  if (_sbt) _sbt.textContent = 'SAVE INVOICE';
  document.getElementById('btn-print-receipt').disabled = true;
  document.getElementById('btn-email-receipt').disabled = true;
  document.getElementById('btn-void-invoice').disabled = true;
  document.getElementById('btn-refund').disabled = true;
}

async function loadInvoice(invoiceNumber, invoiceId) {
  let url = invoiceId ? `/api/invoices/${invoiceId}` : `/api/invoices?search=${invoiceNumber}`;
  const res = await fetch(url);
  if (!res.ok) { showAlert('Invoice not found', 'danger'); return; }
  
  let inv;
  if (invoiceId) {
    inv = await res.json();
  } else {
    const list = await res.json();
    inv = list.find(i => i.invoice_number == invoiceNumber);
    if (!inv) { showAlert('Invoice not found', 'danger'); return; }
  }

  currentInvoiceId = inv.id;
  document.getElementById('inv-id').value = inv.id;
  document.getElementById('inv-number-display').textContent = inv.invoice_number;
  document.getElementById('inv-customer-id').value = inv.customer_id || '';
  document.getElementById('inv-rego').value = inv.rego || '';
  document.getElementById('inv-last-name').value = inv.last_name || '';
  document.getElementById('inv-first-name').value = inv.first_name || '';
  document.getElementById('inv-phone').value = inv.phone || '';
  document.getElementById('inv-email').value = inv.email || '';
  document.getElementById('inv-notes').value = inv.notes || '';
  document.getElementById('inv-flight-info').value = inv.flight_info || '';
  document.getElementById('inv-flight-type').value = inv.flight_type || 'Standard - On Flight';
  document.getElementById('inv-total-price').value = inv.total_price || '';
  document.getElementById('inv-payment-amount').value = inv.payment_amount || '';
  document.getElementById('inv-paid-status').value = inv.paid_status || 'To Pay';
  document.getElementById('inv-payment-amount-2').value = inv.payment_amount_2 || '';
  document.getElementById('inv-paid-status-2').value = inv.paid_status_2 || '';
  document.getElementById('inv-do-not-move').checked = !!inv.do_not_move;
  document.getElementById('inv-picked-up').value = inv.picked_up || 'Car In Yard';
  document.getElementById('inv-account-customer').value = inv.account_customer_id || '';
  document.getElementById('inv-discount-10').checked = inv.discount_percent == 10;

  if (inv.date_in) document.getElementById('inv-date-in').value = inv.date_in.split('T')[0];
  if (inv.time_in) document.getElementById('inv-time-in').value = inv.time_in;
  if (inv.return_date) document.getElementById('inv-return-date').value = inv.return_date.split('T')[0];
  if (inv.return_time) document.getElementById('inv-return-time').value = inv.return_time;

  // Key
  if (inv.no_key) {
    document.getElementById('inv-no-key').checked = true;
    document.getElementById('inv-key-number').value = '';
  } else if (inv.key_number) {
    // Add key to select if not present
    const keySel = document.getElementById('inv-key-number');
    let found = Array.from(keySel.options).find(o => o.value == inv.key_number);
    if (!found) {
      const opt = document.createElement('option');
      opt.value = inv.key_number;
      opt.textContent = `Key ${inv.key_number}`;
      keySel.appendChild(opt);
    }
    keySel.value = inv.key_number;
  }

  // Split payment
  if (inv.payment_amount_2 > 0 || inv.paid_status_2) {
    document.getElementById('split-payment-toggle').checked = true;
    document.getElementById('payment2-section').classList.remove('d-none');
  }

  // Customer alert
  if (inv.customer_alert) {
    setCustomerAlertText(inv.customer_alert);
  }

  updateNightsAndDisplay();
  document.getElementById('inv-status-badge').innerHTML = inv.void
    ? `<span class="badge bg-secondary">VOIDED</span>`
    : `<span class="badge bg-success">SAVED</span>`;
  const _sbt2 = document.getElementById('save-btn-text');
  if (_sbt2) _sbt2.textContent = 'UPDATE INVOICE';
  document.getElementById('btn-print-receipt').disabled = false;
  document.getElementById('btn-email-receipt').disabled = false;
  document.getElementById('btn-void-invoice').disabled = !!inv.void;
  document.getElementById('btn-refund').disabled = false;
}

function updateNightsAndDisplay() {
  const dateIn = document.getElementById('inv-date-in').value;
  const returnDate = document.getElementById('inv-return-date').value;
  const timeIn = document.getElementById('inv-time-in').value;
  const nights = calcNights(dateIn, returnDate);
  document.getElementById('inv-nights').value = nights;
  document.getElementById('date-in-display').textContent = dateIn ? formatDate(dateIn) : 'Not set';
  document.getElementById('time-in-display').textContent = timeIn || '--:--';
}

// ─── Rego auto-populate ───────────────────────────────────────────────────────
// When staff enters a rego and moves away, look up the most recent invoice for
// that rego and fill in all customer/vehicle details automatically.
document.getElementById('inv-rego').addEventListener('blur', async () => {
  const rego = document.getElementById('inv-rego').value.trim();
  if (!rego || currentInvoiceId) return; // Don't overwrite when editing existing

  const res = await fetch(`/api/invoices/lookup-rego?rego=${encodeURIComponent(rego)}`);
  if (!res.ok) return;
  const inv = await res.json();
  if (!inv) return; // New customer, no history

  // Only populate fields that are currently empty
  const fill = (id, val) => { if (val && !document.getElementById(id).value) document.getElementById(id).value = val; };
  fill('inv-last-name', inv.last_name);
  fill('inv-first-name', inv.first_name);
  fill('inv-phone', inv.phone);
  fill('inv-email', inv.email);
  if (inv.customer_id && !document.getElementById('inv-customer-id').value) {
    document.getElementById('inv-customer-id').value = inv.customer_id;
  }
  // Show customer alert if any
  const alertText = inv.customer_alert || inv.customer_alert_stored;
  if (alertText) {
    setCustomerAlertText(alertText);
  }
  showAlert(`✓ Details auto-filled from previous visit (Invoice #${inv.invoice_number})`, 'info');
});

// Also trigger lookup on Enter key in rego field
document.getElementById('inv-rego').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('inv-rego').blur(); }
});

// ─── Event listeners ──────────────────────────────────────────────────────────
document.getElementById('inv-date-in').addEventListener('change', updateNightsAndDisplay);
document.getElementById('inv-return-date').addEventListener('change', () => {
  updateNightsAndDisplay();
  loadFlightsForDate(document.getElementById('inv-return-date').value);
});
document.getElementById('inv-time-in').addEventListener('change', updateNightsAndDisplay);

document.getElementById('btn-prev-date').addEventListener('click', () => {
  const d = new Date(document.getElementById('inv-return-date').value || today());
  d.setDate(d.getDate() - 1);
  document.getElementById('inv-return-date').value = d.toISOString().split('T')[0];
  updateNightsAndDisplay();
});

document.getElementById('btn-next-date').addEventListener('click', () => {
  const d = new Date(document.getElementById('inv-return-date').value || today());
  d.setDate(d.getDate() + 1);
  document.getElementById('inv-return-date').value = d.toISOString().split('T')[0];
  updateNightsAndDisplay();
});

document.getElementById('split-payment-toggle').addEventListener('change', (e) => {
  document.getElementById('payment2-section').classList.toggle('d-none', !e.target.checked);
});

document.getElementById('inv-no-key').addEventListener('change', (e) => {
  document.getElementById('inv-key-number').disabled = e.target.checked;
  if (e.target.checked) document.getElementById('inv-key-number').value = '';
});

// ─── Flight arrival dropdown – populated from /api/flights/arrivals ───────────
async function loadFlightsForDate(dateStr) {
  const sel = document.getElementById('inv-flight-arrival-select');
  try {
    const date = dateStr || document.getElementById('inv-return-date').value || new Date().toISOString().split('T')[0];
    const res = await fetch(`/api/flights/arrivals?date=${date}`);
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json();

    // Day name for the label
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const dayName = days[data.dayOfWeek] || '';

    sel.innerHTML = `<option value="">✈ ${dayName} flights (BOI/KKE)</option>`;
    (data.flights || []).forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.time;
      opt.textContent = `${f.time} – ${f.label} (${f.flight})`;
      sel.appendChild(opt);
    });
  } catch (_) {
    sel.innerHTML = `<option value="">✈ Flights (BOI/KKE)</option>
      <option value="08:45">08:45 – Morning (NZ8391)</option>
      <option value="11:45">11:45 – Midday (NZ8393)</option>
      <option value="14:35">14:35 – Afternoon (NZ8395)</option>
      <option value="16:35">16:35 – Late afternoon (NZ8397)</option>
      <option value="19:00">19:00 – Evening (NZ8399)</option>`;
  }
}

// When a flight arrival is selected, copy the time into the Return Time field
document.getElementById('inv-flight-arrival-select').addEventListener('change', (e) => {
  if (e.target.value) {
    document.getElementById('inv-return-time').value = e.target.value;
    // Reset select back to placeholder so it's usable again
    e.target.value = '';
  }
});

// ─── 10% Discount: auto-recalculate when toggled (if price already calculated) ─
document.getElementById('inv-discount-10').addEventListener('change', () => {
  const total = parseFloat(document.getElementById('inv-total-price').value);
  if (!total || total === 0) return; // Nothing to recalculate yet

  const breakdown = document.getElementById('price-breakdown').textContent;
  // Extract base price from breakdown (recalculate via button or apply/remove discount directly)
  const isChecked = document.getElementById('inv-discount-10').checked;

  // Re-fetch a clean calculate if we have the nights value
  const nights = parseInt(document.getElementById('inv-nights').value) || 1;
  const accountId = document.getElementById('inv-account-customer').value;
  fetch(`/api/invoices/calculate-price?nights=${nights}&account_customer_id=${accountId}`)
    .then(r => r.json())
    .then(data => {
      let newTotal = data.total;
      if (isChecked) newTotal = newTotal * 0.9;
      document.getElementById('inv-total-price').value = newTotal.toFixed(2);
      document.getElementById('inv-payment-amount').value = newTotal.toFixed(2);
      let b = `${nights} night(s) × $${data.dailyRate}/night = $${data.total.toFixed(2)}`;
      if (data.discountPercent > 0) b += ` (${data.discountPercent}% account discount)`;
      if (isChecked) b += ` → -10% = $${newTotal.toFixed(2)}`;
      document.getElementById('price-breakdown').textContent = b;
    });
});

// ─── Auto-release key when vehicle is collected ───────────────────────────────
document.getElementById('inv-picked-up').addEventListener('change', async (e) => {
  const status = e.target.value;
  if (status !== 'Picked Up' && status !== 'Delivered') return;
  if (!currentInvoiceId) return; // Not saved yet

  const keyNum = document.getElementById('inv-key-number').value;
  if (!keyNum || document.getElementById('inv-no-key').checked) return;

  // Release the key automatically
  try {
    await fetch(`/api/keybox/${keyNum}/release`, { method: 'POST' });
    showAlert(`Key ${keyNum} released — slot now available`, 'success');
  } catch (err) {
    console.warn('Key release failed:', err);
  }
});

// Auto-fill payment when status selected
document.getElementById('inv-paid-status').addEventListener('change', () => {
  const total = parseFloat(document.getElementById('inv-total-price').value) || 0;
  const p2 = parseFloat(document.getElementById('inv-payment-amount-2').value) || 0;
  if (total > 0 && !document.getElementById('inv-payment-amount').value) {
    document.getElementById('inv-payment-amount').value = (total - p2).toFixed(2);
  }
});

// Calculate price
document.getElementById('btn-calculate').addEventListener('click', async () => {
  const nights = parseInt(document.getElementById('inv-nights').value) || 1;
  const accountId = document.getElementById('inv-account-customer').value;
  const res = await fetch(`/api/invoices/calculate-price?nights=${nights}&account_customer_id=${accountId}`);
  if (!res.ok) return;
  const data = await res.json();

  let total = data.total;
  if (document.getElementById('inv-discount-10').checked) {
    total = total * 0.9;
  }

  document.getElementById('inv-total-price').value = total.toFixed(2);
  document.getElementById('inv-payment-amount').value = total.toFixed(2);
  let breakdown = `${nights} night(s) × $${data.dailyRate}/night = $${data.total.toFixed(2)}`;
  if (data.discountPercent > 0) breakdown += ` (${data.discountPercent}% account discount applied)`;
  if (document.getElementById('inv-discount-10').checked) breakdown += ` (-10% discount)`;
  document.getElementById('price-breakdown').textContent = breakdown;
});

// Search customer
document.getElementById('btn-search-customer').addEventListener('click', async () => {
  const search = document.getElementById('customer-search').value.trim();
  if (!search) return;
  const res = await fetch(`/api/customers?search=${encodeURIComponent(search)}`);
  if (!res.ok) return;
  const customers = await res.json();

  const container = document.getElementById('customer-search-results');
  if (customers.length === 0) {
    container.innerHTML = '<div class="alert alert-info small py-2">No customers found. Fill in the form to create a new customer.</div>';
    return;
  }

  container.innerHTML = `
    <div class="table-responsive">
      <table class="table table-sm table-hover border">
        <thead><tr><th>Name</th><th>Phone</th><th>Rego</th><th></th></tr></thead>
        <tbody>
          ${customers.map(c => `
            <tr>
              <td>${c.last_name || ''}, ${c.first_name || ''}</td>
              <td>${c.phone || ''}</td>
              <td>${c.email || ''}</td>
              <td><button class="btn btn-sm btn-primary select-customer" data-id="${c.id}" 
                  data-firstname="${c.first_name||''}" data-lastname="${c.last_name||''}"
                  data-phone="${c.phone||''}" data-email="${c.email||''}"
                  data-alert="${c.alert_message||''}">Select</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  container.querySelectorAll('.select-customer').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('inv-customer-id').value = btn.dataset.id;
      document.getElementById('inv-first-name').value = btn.dataset.firstname;
      document.getElementById('inv-last-name').value = btn.dataset.lastname;
      document.getElementById('inv-phone').value = btn.dataset.phone;
      document.getElementById('inv-email').value = btn.dataset.email;
      if (btn.dataset.alert) {
        setCustomerAlertText(btn.dataset.alert);
      }
      container.innerHTML = '';
      document.getElementById('customer-search').value = '';
    });
  });
});

document.getElementById('customer-search').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-search-customer').click();
});

// Load invoice by number
document.getElementById('btn-load-invoice').addEventListener('click', async () => {
  const num = document.getElementById('inv-load-number').value.trim();
  if (num) await loadInvoice(num, null);
});

document.getElementById('inv-load-number').addEventListener('keypress', async (e) => {
  if (e.key === 'Enter') document.getElementById('btn-load-invoice').click();
});

// New invoice button
document.getElementById('btn-new-invoice').addEventListener('click', () => {
  newInvoice();
  history.replaceState(null, '', '/invoice.html');
});

// Customer alert modal
document.getElementById('btn-customer-alert').addEventListener('click', () => {
  document.getElementById('modal-alert-text').value = getCustomerAlertText() || '';
  new bootstrap.Modal('#alertModal').show();
});

document.getElementById('btn-save-alert').addEventListener('click', () => {
  const alertText = document.getElementById('modal-alert-text').value.trim();
  setCustomerAlertText(alertText);
  bootstrap.Modal.getInstance('#alertModal').hide();
});

// Save invoice form
document.getElementById('invoiceForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (_saving) return; // prevent double-submit / race condition

  const invNum = document.getElementById('inv-number-display').textContent;
  if (!invNum || invNum === 'NEW') {
    showAlert('Invoice number not set', 'danger');
    return;
  }

  const payload = {
    invoice_number: invNum,
    customer_id: document.getElementById('inv-customer-id').value || null,
    account_customer_id: document.getElementById('inv-account-customer').value || null,
    key_number: document.getElementById('inv-no-key').checked ? null : (document.getElementById('inv-key-number').value || null),
    no_key: document.getElementById('inv-no-key').checked,
    rego: document.getElementById('inv-rego').value,
    first_name: document.getElementById('inv-first-name').value,
    last_name: document.getElementById('inv-last-name').value,
    phone: document.getElementById('inv-phone').value,
    email: document.getElementById('inv-email').value,
    date_in: document.getElementById('inv-date-in').value,
    time_in: document.getElementById('inv-time-in').value,
    return_date: document.getElementById('inv-return-date').value,
    return_time: document.getElementById('inv-return-time').value,
    stay_nights: document.getElementById('inv-nights').value,
    flight_info: document.getElementById('inv-flight-info').value,
    flight_type: document.getElementById('inv-flight-type').value,
    total_price: document.getElementById('inv-total-price').value,
    discount_percent: document.getElementById('inv-discount-10').checked ? 10 : 0,
    paid_status: document.getElementById('inv-paid-status').value,
    payment_amount: document.getElementById('inv-payment-amount').value,
    paid_status_2: document.getElementById('inv-paid-status-2').value || null,
    payment_amount_2: document.getElementById('inv-payment-amount-2').value || 0,
    do_not_move: document.getElementById('inv-do-not-move').checked,
    picked_up: document.getElementById('inv-picked-up').value,
    staff_id: document.getElementById('inv-staff').value,
    notes: document.getElementById('inv-notes').value,
    customer_alert: getCustomerAlertText() || null
  };

  _saving = true;
  const btn     = document.getElementById('btn-save');
  const btnNew  = document.getElementById('btn-new-invoice');
  const btnLoad = document.getElementById('btn-load-invoice');
  btn.disabled  = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving...';
  if (btnNew)  btnNew.disabled  = true;
  if (btnLoad) btnLoad.disabled = true;

  try {
    let res;
    if (currentInvoiceId) {
      res = await fetch(`/api/invoices/${currentInvoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    if (!res.ok) {
      const err = await res.json();
      showAlert(err.error || 'Failed to save invoice', 'danger');
    } else {
      const inv = await res.json();
      currentInvoiceId = inv.id;
      document.getElementById('inv-id').value = inv.id;
      document.getElementById('inv-status-badge').innerHTML = `<span class="badge bg-success">SAVED</span>`;
      // NOTE: do NOT touch save-btn-text here – the spinner already replaced
      // the button innerHTML so that span no longer exists.  The btn.innerHTML
      // line AFTER this try/catch restores the full button (including the span).
      document.getElementById('btn-print-receipt').disabled = false;
      document.getElementById('btn-email-receipt').disabled = false;
      document.getElementById('btn-void-invoice').disabled = false;
      document.getElementById('btn-refund').disabled = false;
      showAlert('Invoice saved successfully!', 'success');
      history.replaceState(null, '', `/invoice.html?id=${inv.id}`);

      // Save customer if new
      if (!payload.customer_id && (payload.first_name || payload.last_name)) {
        const custRes = await fetch('/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            first_name: payload.first_name,
            last_name: payload.last_name,
            phone: payload.phone,
            email: payload.email
          })
        });
        if (custRes.ok) {
          const cust = await custRes.json();
          document.getElementById('inv-customer-id').value = cust.id;
        }
      }
    }
  } catch(err) {
    showAlert('Error saving invoice: ' + err.message, 'danger');
  }

  _saving = false;
  btn.disabled  = false;
  btn.innerHTML = `<i class="bi bi-floppy me-2"></i><span id="save-btn-text">UPDATE INVOICE</span>`;
  if (btnNew)  btnNew.disabled  = false;
  if (btnLoad) btnLoad.disabled = false;
  updateNavCarsCount();
});

// Print/View receipt
document.getElementById('btn-print-receipt').addEventListener('click', () => {
  if (currentInvoiceId) {
    window.open(`/api/invoices/${currentInvoiceId}/pdf`, '_blank');
  }
});

// Email receipt
document.getElementById('btn-email-receipt').addEventListener('click', async () => {
  if (!currentInvoiceId) return;
  const email = document.getElementById('inv-email').value;
  if (!email) { showAlert('No email address on this invoice – please enter one and save first.', 'warning'); return; }

  const btn = document.getElementById('btn-email-receipt');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Sending…';

  try {
    const res = await fetch(`/api/email/receipt/${currentInvoiceId}`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showAlert(`✅ Receipt sent to ${email}`, 'success');
    } else {
      showAlert('Failed to send receipt: ' + (data.error || 'Unknown error'), 'danger');
    }
  } catch (err) {
    showAlert('Error sending receipt: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-envelope me-1"></i> Email Receipt';
  }
});

// Void invoice
document.getElementById('btn-void-invoice').addEventListener('click', async () => {
  if (!currentInvoiceId) return;
  if (!confirm('Are you sure you want to VOID this invoice? This cannot be undone.')) return;
  const res = await fetch(`/api/invoices/${currentInvoiceId}/void`, { method: 'POST' });
  if (res.ok) {
    showAlert('Invoice voided', 'warning');
    document.getElementById('inv-status-badge').innerHTML = `<span class="badge bg-secondary">VOIDED</span>`;
    document.getElementById('inv-picked-up').value = 'Voided';
    document.getElementById('btn-void-invoice').disabled = true;
    updateNavCarsCount();
  }
});

// Refund
document.getElementById('btn-refund').addEventListener('click', () => {
  new bootstrap.Modal('#refundModal').show();
});

document.getElementById('btn-confirm-refund').addEventListener('click', async () => {
  if (!currentInvoiceId) return;
  const amount = document.getElementById('refund-amount').value;
  const reason = document.getElementById('refund-reason').value;
  const res = await fetch(`/api/invoices/${currentInvoiceId}/refund`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refund_amount: amount, refund_reason: reason })
  });
  if (res.ok) {
    showAlert(`Refund of $${amount} recorded`, 'success');
    bootstrap.Modal.getInstance('#refundModal').hide();
  }
});

initInvoicePage();
