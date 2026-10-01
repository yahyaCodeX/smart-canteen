// public/js/app.js
// Client-side Logic for Smart Canteen AI Web Application

const API_BASE = '/api';

// Demo Credentials & Auth State
const DEMO_ACCOUNTS = {
  customer: { email: 'customer@demo.com', password: 'demoPassword123!', role: 'CUSTOMER' },
  staff:    { email: 'staff@demo.com',    password: 'demoPassword123!', role: 'STAFF' },
  manager:  { email: 'manager@demo.com',  password: 'demoPassword123!', role: 'MANAGER' },
  admin:    { email: 'admin@demo.com',    password: 'demoPassword123!', role: 'ADMIN' },
};

let currentRole = 'customer';
let jwtToken = null;
let cart = []; // Array of { item, quantity, instructions }
let allMenuItems = [];
let selectedCategory = 'ALL';
let pollInterval = null;

// ─────────────────────────────────────────────────────────────────────────────
// Initialization & Authentication
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await switchRole('customer');
  await loadMenuItems();
  setupPolling();
});

async function switchRole(roleKey) {
  currentRole = roleKey;
  const account = DEMO_ACCOUNTS[roleKey];
  document.getElementById('current-role-badge').textContent = account.role;
  document.getElementById('role-select').value = roleKey;

  // Toggle Analytics Tab visibility
  const navAnalyticsBtn = document.getElementById('nav-analytics-btn');
  if (navAnalyticsBtn) {
    navAnalyticsBtn.style.display = (roleKey === 'manager' || roleKey === 'admin') ? 'inline-block' : 'none';
  }

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: account.email, password: account.password }),
    });
    const data = await res.json();
    if (data.success) {
      jwtToken = data.token;
      showToast(`Switched role to ${account.role}`, 'info');

      // AI Recommendations for customers
      const aiRecContainer = document.getElementById('ai-recommendations-container');
      if (aiRecContainer) {
        if (roleKey === 'customer') {
          aiRecContainer.style.display = 'block';
          loadAIRecommendations();
        } else {
          aiRecContainer.style.display = 'none';
        }
      }

      // Reload current tab data
      const activeTab = document.querySelector('.tab-content.active');
      if (activeTab) {
        refreshTabData(activeTab.id);
      }
    }
  } catch (err) {
    console.error('Login error:', err);
  }
}

function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (jwtToken) {
    headers['Authorization'] = `Bearer ${jwtToken}`;
  }
  return headers;
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigation & Tab Management
// ─────────────────────────────────────────────────────────────────────────────
function showTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

  event.currentTarget.classList.add('active');
  const targetTab = document.getElementById(tabId);
  targetTab.classList.add('active');

  refreshTabData(tabId);
}

function refreshTabData(tabId) {
  if (tabId === 'menu-tab') loadMenuItems();
  if (tabId === 'tokens-tab') loadUserOrders();
  if (tabId === 'queue-tab') loadKitchenQueue();
  if (tabId === 'intel-tab') loadIntelligenceData();
  if (tabId === 'analytics-tab') loadAnalytics();
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 1: Menu & Cart System
// ─────────────────────────────────────────────────────────────────────────────
async function loadMenuItems() {
  try {
    const res = await fetch(`${API_BASE}/menu`);
    const data = await res.json();
    if (data.success) {
      allMenuItems = data.items;
      renderMenu();
    }
  } catch (err) {
    console.error('Failed to load menu:', err);
  }
}

function filterCategory(cat) {
  selectedCategory = cat;
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.includes(cat) || (cat === 'ALL' && btn.textContent.includes('All')));
  });
  renderMenu();
}

function renderMenu() {
  const grid = document.getElementById('food-grid');
  grid.innerHTML = '';

  const itemsToDisplay = selectedCategory === 'ALL'
    ? allMenuItems
    : allMenuItems.filter(i => i.category.toLowerCase() === selectedCategory.toLowerCase());

  document.getElementById('menu-count-text').textContent = `${itemsToDisplay.length} items available`;

  itemsToDisplay.forEach(item => {
    const card = document.createElement('div');
    card.className = 'food-card';
    card.innerHTML = `
      <div>
        <div class="food-card-header">
          <div class="food-title">${escapeHtml(item.name)}</div>
          <span class="food-tag">${escapeHtml(item.category)}</span>
        </div>
        <div class="food-meta">
          <span>⏱️ ${item.preparation_time_minutes} min prep</span>
          <span>•</span>
          <span style="color: ${item.available ? 'var(--accent-emerald)' : 'var(--accent-rose)'}">
            ${item.available ? 'In Stock' : 'Sold Out'}
          </span>
        </div>
      </div>
      <div>
        <div class="food-price">₹${parseFloat(item.price).toFixed(2)}</div>
        <button class="add-btn" onclick="addToCart('${item.id}')" ${!item.available ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>
          + Add to Order
        </button>
      </div>
    `;
    grid.appendChild(card);
  });
}

function addToCart(itemId) {
  const item = allMenuItems.find(i => i.id === itemId);
  if (!item) return;

  const existing = cart.find(c => c.item.id === itemId);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ item, quantity: 1, instructions: '' });
  }

  renderCart();
  recalculateEPT();
  showToast(`Added ${item.name} to cart`);
}

function updateCartQty(itemId, delta) {
  const index = cart.findIndex(c => c.item.id === itemId);
  if (index === -1) return;

  cart[index].quantity += delta;
  if (cart[index].quantity <= 0) {
    cart.splice(index, 1);
  }
  renderCart();
  recalculateEPT();
}

function updateCartInstructions(itemId, text) {
  const c = cart.find(i => i.item.id === itemId);
  if (c) c.instructions = text;
}

function clearCart() {
  cart = [];
  renderCart();
  recalculateEPT();
}

function renderCart() {
  const container = document.getElementById('cart-items');
  container.innerHTML = '';

  if (cart.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); margin-top: 3rem;">
        Your cart is empty.<br>Select items from the menu to start.
      </div>
    `;
    document.getElementById('cart-total-price').textContent = '₹0.00';
    return;
  }

  let total = 0;
  cart.forEach(entry => {
    const itemTotal = parseFloat(entry.item.price) * entry.quantity;
    total += itemTotal;

    const div = document.createElement('div');
    div.className = 'cart-item';
    div.innerHTML = `
      <div class="cart-item-header">
        <span>${escapeHtml(entry.item.name)}</span>
        <span>₹${itemTotal.toFixed(2)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div class="qty-controls">
          <button class="qty-btn" onclick="updateCartQty('${entry.item.id}', -1)">-</button>
          <span style="font-weight:700; font-size:0.9rem;">${entry.quantity}</span>
          <button class="qty-btn" onclick="updateCartQty('${entry.item.id}', 1)">+</button>
        </div>
        <span style="font-size:0.75rem; color:var(--text-muted);">₹${entry.item.price}/ea</span>
      </div>
      <input type="text" class="item-inst" placeholder="Special note (e.g. extra spicy)" value="${escapeHtml(entry.instructions)}" onchange="updateCartInstructions('${entry.item.id}', this.value)">
    `;
    container.appendChild(div);
  });

  document.getElementById('cart-total-price').textContent = `₹${total.toFixed(2)}`;
}

function togglePickupTime(val) {
  const timeInput = document.getElementById('scheduled-time-input');
  timeInput.style.display = val === 'SCHEDULED' ? 'block' : 'none';
  if (val === 'SCHEDULED' && !document.getElementById('pickup-time-val').value) {
    // Default to 45 mins from now
    const d = new Date(Date.now() + 45 * 60000);
    const hrs = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    document.getElementById('pickup-time-val').value = `${hrs}:${mins}`;
  }
  recalculateEPT();
}

async function recalculateEPT() {
  if (cart.length === 0) {
    document.getElementById('ept-value').textContent = '0 Mins';
    return;
  }

  const itemsPayload = cart.map(c => ({ item_id: c.item.id, quantity: c.quantity }));

  try {
    const res = await fetch(`${API_BASE}/intelligence/simulate-ept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: itemsPayload }),
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('ept-value').textContent = `${data.simulation.estimated_prep_time_minutes} Mins`;
    }
  } catch (err) {
    console.error('EPT simulation error:', err);
  }
}

async function submitOrder() {
  if (cart.length === 0) {
    showToast('Your cart is empty!', 'warning');
    return;
  }

  const pickupType = document.getElementById('pickup-type').value;
  let scheduledPickupTime = null;

  if (pickupType === 'SCHEDULED') {
    const timeVal = document.getElementById('pickup-time-val').value;
    if (!timeVal) {
      showToast('Please select a pickup time!', 'warning');
      return;
    }
    const [hrs, mins] = timeVal.split(':');
    const targetDate = new Date();
    targetDate.setHours(parseInt(hrs), parseInt(mins), 0, 0);
    if (targetDate.getTime() < Date.now()) {
      // Assuming next day or prompt error
      showToast('Pickup time must be in the future today.', 'warning');
      return;
    }
    scheduledPickupTime = targetDate.toISOString();
  }

  const orderItems = cart.map(c => ({
    item_id: c.item.id,
    quantity: c.quantity,
    special_instructions: c.instructions,
  }));

  // Generate unique idempotency key
  const idempotencyKey = `ORDER-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

  try {
    const res = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        items: orderItems,
        scheduled_pickup_time: scheduledPickupTime,
      }),
    });

    const data = await res.json();
    if (data.success) {
      showToast(`🎉 Order Placed! Token: ${data.order.token_number}`, 'success');
      clearCart();
      showTab('tokens-tab');
      loadUserOrders();
    } else {
      showToast(`Error: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast('Order creation failed.', 'error');
  }
}

let previousOrderStatuses = {}; // For tracking READY status transitions

// ─────────────────────────────────────────────────────────────────────────────
// Tab 2: User Digital Tokens & 20-Step Lifecycle
// ─────────────────────────────────────────────────────────────────────────────
async function loadUserOrders() {
  try {
    const res = await fetch(`${API_BASE}/orders/my`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (data.success) {
      // Check for status changes to notify customer
      data.orders.forEach(order => {
        const prevStatus = previousOrderStatuses[order.order_id];
        
        if (prevStatus && prevStatus !== order.order_status) {
          if (order.order_status === 'ACCEPTED') {
            showToast(`👍 Token ${order.token_number} — Your order has been accepted!`, 'info');
          } else if (order.order_status === 'PREPARING') {
            showToast(`🔥 Token ${order.token_number} — Your order is now being prepared!`, 'info');
          } else if (order.order_status === 'DELAYED') {
            showToast(`⚠️ Token ${order.token_number} — Your order is delayed. The kitchen is busy!`, 'warning');
          } else if (order.order_status === 'READY') {
            showToast(`🔔 Token ${order.token_number} — Your order is ready for collection!`, 'success');
          } else if (order.order_status === 'CANCELLED') {
            showToast(`❌ Token ${order.token_number} — Your order was cancelled.`, 'error');
          }
        }
        previousOrderStatuses[order.order_id] = order.order_status;
      });

      renderTokens(data.orders);
      document.getElementById('active-tokens-count').textContent = data.orders.filter(o => o.order_status !== 'COMPLETED' && o.order_status !== 'CANCELLED').length;
    }
  } catch (err) {
    console.error('Failed to load user orders:', err);
  }
}

function renderTokens(orders) {
  const container = document.getElementById('tokens-grid');
  container.innerHTML = '';

  if (orders.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 4rem 0;">
        No active orders found. Place an order from the menu tab!
      </div>
    `;
    return;
  }

  orders.forEach(order => {
    const card = document.createElement('div');
    card.className = 'token-card';

    // Status lifecycle step mapping
    const steps = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'COLLECTED', 'COMPLETED'];
    const currentStepIndex = steps.indexOf(order.order_status);

    const itemsSummary = order.items
      .map(i => `${i.quantity}x ${i.item_name || 'Item'}`)
      .join(', ');

    const readyTimeFormatted = order.estimated_ready_time
      ? new Date(order.estimated_ready_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'Calculating...';

    card.innerHTML = `
      <div class="token-header">
        <div>
          <div style="font-size:0.75rem; color:var(--text-secondary);">DIGITAL TOKEN</div>
          <div class="token-number">${order.token_number}</div>
        </div>
        <span class="status-pill status-${order.order_status}">${order.order_status}</span>
      </div>

      <div style="font-size:0.9rem; margin-bottom:0.75rem;">
        <strong>Items:</strong> ${escapeHtml(itemsSummary)}
      </div>

      <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--text-secondary); margin-bottom:1rem;">
        <span>⏱️ Estimated Ready: <strong>${readyTimeFormatted}</strong></span>
        <span>Total: <strong>₹${parseFloat(order.total_amount).toFixed(2)}</strong></span>
      </div>

      <!-- Lifecycle Progress Tracker -->
      <div style="font-size:0.75rem; font-weight:600; color:var(--text-secondary); margin-bottom:0.25rem;">Order Lifecycle Progress</div>
      <div class="lifecycle-tracker">
        ${steps.map((st, idx) => {
          let stateClass = '';
          if (idx < currentStepIndex) stateClass = 'done';
          if (idx === currentStepIndex) stateClass = 'current';
          return `<div class="lifecycle-step ${stateClass}">${idx + 1}</div>`;
        }).join('')}
      </div>

      ${order.order_status === 'READY' ? `
        <button class="checkout-btn" onclick="confirmOrderCollection('${order.order_id}')" style="margin-top:0.5rem; width:100%;">
          ✅ Confirm Food Collection
        </button>
      ` : ''}
    `;

    container.appendChild(card);
  });
}

async function confirmOrderCollection(orderId) {
  try {
    const res = await fetch(`${API_BASE}/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status: 'COLLECTED' }),
    });
    const data = await res.json();
    if (data.success) {
      showToast('Food collected! Thank you.', 'success');
      loadUserOrders();
    }
  } catch (err) {
    showToast('Failed to update status.', 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 3: Kitchen Queue Board (Staff View)
// ─────────────────────────────────────────────────────────────────────────────
async function loadKitchenQueue() {
  try {
    const res = await fetch(`${API_BASE}/queue`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (data.success) {
      renderKitchenQueue(data.queue.active, data.queue.scheduled);
      document.getElementById('active-queue-count').textContent = `${data.queue.active.length} Active`;
      document.getElementById('scheduled-queue-count').textContent = `${data.queue.scheduled.length} Scheduled`;
    }
  } catch (err) {
    console.error('Failed to load kitchen queue:', err);
  }
}

function renderKitchenQueue(activeList, scheduledList) {
  const activeContainer = document.getElementById('active-queue-list');
  const scheduledContainer = document.getElementById('scheduled-queue-list');

  activeContainer.innerHTML = '';
  scheduledContainer.innerHTML = '';

  if (activeList.length === 0) {
    activeContainer.innerHTML = `<div style="color:var(--text-muted); text-align:center; padding:2rem;">No active kitchen orders.</div>`;
  } else {
    activeList.forEach(order => activeContainer.appendChild(createQueueCard(order, true)));
  }

  if (scheduledList.length === 0) {
    scheduledContainer.innerHTML = `<div style="color:var(--text-muted); text-align:center; padding:2rem;">No upcoming scheduled orders.</div>`;
  } else {
    scheduledList.forEach(order => scheduledContainer.appendChild(createQueueCard(order, false)));
  }
}

function createQueueCard(order, isActive) {
  const div = document.createElement('div');
  div.className = `queue-card ${order.is_delayed ? 'delayed' : ''}`;

  const itemsStr = order.items
    .map(i => `${i.quantity}x ${i.item_name}`)
    .join(', ');

  div.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.5rem;">
      <div>
        <span class="token-number" style="font-size:1.4rem;">${order.token_number}</span>
        <span class="status-pill status-${order.status}" style="margin-left:0.5rem;">${order.status}</span>
      </div>
      ${order.priority_score ? `<span class="priority-score-badge">Score: ${order.priority_score}</span>` : ''}
    </div>

    ${order.is_delayed ? `<div style="font-size:0.75rem; color:var(--accent-rose); font-weight:700; margin-bottom:0.5rem;">⚠️ ORDER DELAYED — HIGH PRIORITY</div>` : ''}

    <div style="font-size:0.85rem; margin-bottom:0.5rem;"><strong>Items:</strong> ${escapeHtml(itemsStr)}</div>

    <div style="font-size:0.75rem; color:var(--text-secondary); display:flex; justify-content:space-between;">
      <span>EPT: ${order.estimated_prep_time_minutes} min</span>
      <span>${order.scheduled_pickup_time ? `Pickup: ${new Date(order.scheduled_pickup_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}` : 'ASAP'}</span>
    </div>

    <div class="action-bar">
      ${order.status === 'PLACED' ? `<button class="action-btn btn-accept" onclick="updateOrderStatus('${order.id}', 'ACCEPTED')">Accept</button>` : ''}
      ${order.status === 'ACCEPTED' ? `<button class="action-btn btn-prep" onclick="updateOrderStatus('${order.id}', 'PREPARING')">Start Prep</button>` : ''}
      ${order.status === 'PREPARING' ? `<button class="action-btn btn-ready" onclick="updateOrderStatus('${order.id}', 'READY')">Mark Ready</button>` : ''}
      ${order.status === 'READY' ? `<button class="action-btn btn-collect" onclick="updateOrderStatus('${order.id}', 'COLLECTED')">Collected</button>` : ''}
      ${order.status !== 'COMPLETED' && order.status !== 'CANCELLED' ? `<button class="action-btn btn-cancel" onclick="updateOrderStatus('${order.id}', 'CANCELLED')">Cancel</button>` : ''}
    </div>
  `;

  return div;
}

async function updateOrderStatus(orderId, newStatus) {
  try {
    const res = await fetch(`${API_BASE}/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status: newStatus }),
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Order updated to ${newStatus}`, 'success');
      loadKitchenQueue();
    } else {
      showToast(`Error: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast('Failed to update status.', 'error');
  }
}

async function verifyTokenCode() {
  const tokenInput = document.getElementById('verify-token-input');
  const token_number = tokenInput.value.trim();
  if (!token_number) {
    showToast('Please enter a token number.', 'warning');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/orders/verify-token`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ token_number }),
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      tokenInput.value = '';
      loadKitchenQueue();
    } else {
      showToast(data.error, 'error');
    }
  } catch (err) {
    showToast('Failed to verify token.', 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 4: Smart Intelligence & Alerts
// ─────────────────────────────────────────────────────────────────────────────
async function loadIntelligenceData() {
  try {
    // Alerts
    const alertsRes = await fetch(`${API_BASE}/intelligence/alerts`, { headers: getAuthHeaders() });
    const alertsData = await alertsRes.json();
    if (alertsData.success) {
      renderAlerts(alertsData.alerts);
    }

    // Kitchen Status
    const statusRes = await fetch(`${API_BASE}/intelligence/status`, { headers: getAuthHeaders() });
    const statusData = await statusRes.json();
    if (statusData.success) {
      document.getElementById('intel-workload-val').textContent = statusData.status.workload_index;
      document.getElementById('intel-active-count-str').textContent = `Active Orders in Kitchen: ${statusData.status.active_orders}`;
    }

    // Forecast
    const fcRes = await fetch(`${API_BASE}/intelligence/forecast`, { headers: getAuthHeaders() });
    const fcData = await fcRes.json();
    if (fcData.success) {
      renderForecast(fcData.forecast);
    }
  } catch (err) {
    console.error('Failed to load intelligence data:', err);
  }
}

function renderAlerts(alerts) {
  const container = document.getElementById('alerts-feed-list');
  container.innerHTML = '';

  const badgeCount = document.getElementById('alerts-count');
  if (alerts.length > 0) {
    badgeCount.textContent = alerts.length;
    badgeCount.style.display = 'inline-block';
  } else {
    badgeCount.style.display = 'none';
    container.innerHTML = `<div style="color:var(--text-muted); text-align:center; padding:2rem;">No active kitchen alerts detected. All operations normal.</div>`;
    return;
  }

  alerts.forEach(alert => {
    const div = document.createElement('div');
    div.className = `alert-item alert-${alert.severity}`;
    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; font-weight:700; font-size:0.85rem; margin-bottom:0.25rem;">
        <span>${escapeHtml(alert.title)}</span>
        <span style="font-size:0.75rem;">${alert.severity}</span>
      </div>
      <div style="font-size:0.8rem; color:var(--text-secondary);">${escapeHtml(alert.message)}</div>
      <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.35rem; display:flex; justify-content:space-between;">
        <span>Token: ${alert.token_number}</span>
        <span>Action: ${escapeHtml(alert.action_recommendation)}</span>
      </div>
    `;
    container.appendChild(div);
  });
}

function renderForecast(forecast) {
  const container = document.getElementById('demand-forecast-list');
  container.innerHTML = '';

  forecast.forEach(item => {
    const div = document.createElement('div');
    div.style.cssText = 'background:rgba(31,41,55,0.4); padding:0.6rem 0.85rem; border-radius:6px; display:flex; justify-content:space-between; font-size:0.85rem;';
    div.innerHTML = `
      <span>📅 ${item.day} (${item.date})</span>
      <span style="font-weight:700; color:var(--accent-cyan);">${item.projected_orders} Orders (${item.busy_period})</span>
    `;
    container.appendChild(div);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 5: Admin Panel
// ─────────────────────────────────────────────────────────────────────────────
async function handleAddItem(e) {
  e.preventDefault();
  const name = document.getElementById('new-item-name').value;
  const category = document.getElementById('new-item-cat').value;
  const price = parseFloat(document.getElementById('new-item-price').value);
  const prep = parseInt(document.getElementById('new-item-prep').value);

  try {
    const res = await fetch(`${API_BASE}/menu`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name, category, price, preparation_time_minutes: prep }),
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Added ${name} to menu!`, 'success');
      document.getElementById('add-item-form').reset();
      loadMenuItems();
    } else {
      showToast(`Error: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast('Failed to add menu item.', 'error');
  }
}

async function triggerSeedReset() {
  if (!confirm('Are you sure you want to reset the database and seed demo data?')) return;
  showToast('Resetting database...', 'info');
  // Re-seed call
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities & Polling Loop
// ─────────────────────────────────────────────────────────────────────────────
function setupPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    const activeTab = document.querySelector('.tab-content.active');
    if (activeTab) {
      if (activeTab.id === 'tokens-tab') loadUserOrders();
      if (activeTab.id === 'queue-tab') loadKitchenQueue();
      if (activeTab.id === 'intel-tab') loadIntelligenceData();
    }
  }, 5000);
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>⚡</span> ${escapeHtml(message)}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 5: Management Analytics
// ─────────────────────────────────────────────────────────────────────────────
async function loadAnalytics() {
  try {
    const res = await fetch(`${API_BASE}/analytics/dashboard`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (data.success) {
      renderAnalytics(data.stats);
    }
  } catch (err) {
    console.error('Failed to load analytics:', err);
  }
}

function renderAnalytics(stats) {
  const container = document.getElementById('analytics-grid');
  if (!container) return;
  container.innerHTML = `
    <div class="glass-panel" style="text-align: center;">
      <h3 style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 0.5rem;">Total Orders Today</h3>
      <div style="font-size: 2rem; font-weight: bold; color: white;">${stats.total_orders}</div>
    </div>
    <div class="glass-panel" style="text-align: center;">
      <h3 style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 0.5rem;">Total Sales Today</h3>
      <div style="font-size: 2rem; font-weight: bold; color: var(--accent-emerald);">₹${stats.total_sales.toFixed(2)}</div>
    </div>
    <div class="glass-panel" style="text-align: center;">
      <h3 style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 0.5rem;">Active Orders (In Kitchen)</h3>
      <div style="font-size: 2rem; font-weight: bold; color: var(--accent-blue);">${stats.active_orders}</div>
    </div>
    <div class="glass-panel" style="text-align: center;">
      <h3 style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 0.5rem;">Orders Preparing</h3>
      <div style="font-size: 2rem; font-weight: bold; color: var(--accent-amber);">${stats.preparing}</div>
    </div>
    <div class="glass-panel" style="text-align: center;">
      <h3 style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 0.5rem;">Orders Ready for Pickup</h3>
      <div style="font-size: 2rem; font-weight: bold; color: var(--accent-emerald);">${stats.ready}</div>
    </div>
    <div class="glass-panel" style="text-align: center;">
      <h3 style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 0.5rem;">Completed Orders</h3>
      <div style="font-size: 2rem; font-weight: bold; color: var(--text-secondary);">${stats.completed}</div>
    </div>
    <div class="glass-panel" style="text-align: center;">
      <h3 style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 0.5rem;">Cancelled Orders</h3>
      <div style="font-size: 2rem; font-weight: bold; color: var(--accent-rose);">${stats.cancelled}</div>
    </div>
    <div class="glass-panel" style="text-align: center;">
      <h3 style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 0.5rem;">Delayed Percentage</h3>
      <div style="font-size: 2rem; font-weight: bold; color: var(--accent-rose);">${stats.delayed_percentage}</div>
    </div>
    <div class="glass-panel" style="text-align: center;">
      <h3 style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 0.5rem;">Avg Preparation Time</h3>
      <div style="font-size: 1.5rem; font-weight: bold; color: var(--accent-purple);">${stats.avg_preparation_time}</div>
    </div>
    <div class="glass-panel" style="text-align: center;">
      <h3 style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 0.5rem;">Peak Ordering Time</h3>
      <div style="font-size: 1.5rem; font-weight: bold; color: var(--accent-cyan);">${stats.peak_ordering_time}</div>
    </div>
    <div class="glass-panel" style="text-align: center;">
      <h3 style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 0.5rem;">Most Ordered Item</h3>
      <div style="font-size: 1.2rem; font-weight: bold; color: white;">${stats.most_ordered}</div>
    </div>
    <div class="glass-panel" style="text-align: center;">
      <h3 style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 0.5rem;">Least Ordered Item</h3>
      <div style="font-size: 1.2rem; font-weight: bold; color: var(--text-muted);">${stats.least_ordered}</div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini AI Integration
// ─────────────────────────────────────────────────────────────────────────────
async function loadAIRecommendations() {
  const list = document.getElementById('ai-recommendations-list');
  if (!list) return;
  list.innerHTML = `<div style="color: var(--text-muted); font-size: 0.9rem;">🤖 Analyzing menu & generating smart recommendations...</div>`;

  try {
    const res = await fetch(`${API_BASE}/intelligence/recommendations`, { headers: getAuthHeaders() });
    const data = await res.json();
    
    if (data.success && data.recommendations) {
      list.innerHTML = data.recommendations.map(rec => `
        <div style="background: rgba(31, 41, 55, 0.6); padding: 0.75rem; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong style="color: white;">${escapeHtml(rec.item_name)}</strong>
            <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.2rem;">✨ ${escapeHtml(rec.reason)}</div>
          </div>
          <button onclick="addToCart('${rec.item_id}')" style="background: var(--accent-purple); color: white; border: none; padding: 0.4rem 0.8rem; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">Add</button>
        </div>
      `).join('');
    } else {
      list.innerHTML = `<div style="color: var(--accent-rose);">${data.error || 'AI recommendations unavailable.'}</div>`;
    }
  } catch (err) {
    console.error('Failed to load AI recommendations:', err);
    list.innerHTML = `<div style="color: var(--accent-rose);">Error connecting to AI service.</div>`;
  }
}

async function loadAIInsights() {
  const container = document.getElementById('ai-insights-content');
  if (!container) return;
  
  container.innerHTML = `<div style="color: var(--text-muted);">🤖 Gemini AI is analyzing live operational data. Please wait...</div>`;

  try {
    const res = await fetch(`${API_BASE}/intelligence/ai-insights`, { headers: getAuthHeaders() });
    const data = await res.json();

    if (data.success && data.insights) {
      const ins = data.insights;
      container.innerHTML = `
        <div style="background: rgba(31, 41, 55, 0.6); padding: 1rem; border-radius: 6px; border-left: 3px solid var(--accent-cyan);">
          <div style="font-size: 0.8rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.25rem;">📈 Demand Prediction</div>
          <div style="color: white; font-size: 0.95rem;">${escapeHtml(ins.food_demand_prediction)}</div>
        </div>
        
        <div style="background: rgba(31, 41, 55, 0.6); padding: 1rem; border-radius: 6px; border-left: 3px solid var(--accent-rose);">
          <div style="font-size: 0.8rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.25rem;">⏰ Peak Time Forecast</div>
          <div style="color: white; font-size: 0.95rem;">${escapeHtml(ins.peak_time_prediction)}</div>
        </div>
        
        <div style="background: rgba(31, 41, 55, 0.6); padding: 1rem; border-radius: 6px; border-left: 3px solid var(--accent-emerald);">
          <div style="font-size: 0.8rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.25rem;">🍳 Preparation Forecasting</div>
          <div style="color: white; font-size: 0.95rem;">${escapeHtml(ins.preparation_forecasting)}</div>
        </div>
        
        <div style="background: rgba(31, 41, 55, 0.6); padding: 1rem; border-radius: 6px; border-left: 3px solid var(--accent-amber);">
          <div style="font-size: 0.8rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.25rem;">⚠️ Delay & Workload Prediction</div>
          <div style="color: white; font-size: 0.95rem;">${escapeHtml(ins.order_delay_prediction)}</div>
        </div>
        
        <div style="background: rgba(31, 41, 55, 0.6); padding: 1rem; border-radius: 6px; border-left: 3px solid var(--accent-purple);">
          <div style="font-size: 0.8rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.25rem;">💡 Smart Promo Ideas</div>
          <div style="color: white; font-size: 0.95rem;">${escapeHtml(ins.smart_recommendation)}</div>
        </div>
        
        <div style="background: rgba(31, 41, 55, 0.6); padding: 1rem; border-radius: 6px; border-left: 3px solid var(--text-muted);">
          <div style="font-size: 0.8rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.25rem;">🗑️ Waste Prevention</div>
          <div style="color: white; font-size: 0.95rem;">${escapeHtml(ins.food_waste_prediction)}</div>
        </div>
        
        <div style="grid-column: 1 / -1; background: rgba(139, 92, 246, 0.2); padding: 1rem; border-radius: 6px; text-align: center; border: 1px solid var(--accent-purple);">
          <div style="font-size: 1.1rem; font-weight: 700; color: white;">"${escapeHtml(ins.sales_insights)}"</div>
          <div style="font-size: 0.75rem; color: var(--accent-purple); margin-top: 0.5rem;">— Gemini Management Insight</div>
        </div>
      `;
    } else {
      container.innerHTML = `<div style="color: var(--accent-rose);">${data.error || 'AI generation failed.'}</div>`;
    }
  } catch (err) {
    console.error('Failed to load AI Insights:', err);
    container.innerHTML = `<div style="color: var(--accent-rose);">Error connecting to AI service.</div>`;
  }
}
