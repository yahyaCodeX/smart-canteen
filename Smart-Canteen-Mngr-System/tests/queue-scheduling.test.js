// tests/queue-scheduling.test.js
// Unit Tests — Smart Queue Scheduling & Prioritization Engine
// Tests the activation window logic, priority scoring, delay detection,
// and two-phase queue model (scheduled vs active)

import { describe, it, expect } from 'vitest';
import {
  calculatePriorityScore,
  getActivationTime,
  isInActivationWindow,
  isDelayedOrder,
} from '../src/services/queue.service.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const now = new Date();
const min = (n) => new Date(now.getTime() + n * 60_000); // n minutes from now (negative = past)

function makeOrder(overrides = {}) {
  return {
    order_id:     'test-uuid',
    token_number: 'C-023',
    order_time:   min(-10),   // placed 10 min ago
    pickup_time:  min(30),    // pickup in 30 min
    order_status: 'PLACED',
    ept_minutes:  10,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Activation Window Logic
// The core scheduling concept from the requirements:
//   "If pickup is at 1:30 PM, don't start prep at 12:30 PM.
//    Start at ~1:15 PM (pickup - EPT - buffer)"
// ─────────────────────────────────────────────────────────────────────────────
describe('Activation window — smart prep scheduling', () => {

  it('activation time = pickup_time - EPT - 5min buffer', () => {
    const pickup = min(60);   // pickup in 60 min
    const ept    = 10;        // 10 min to prepare
    const activation = getActivationTime(pickup, ept);

    // Expected: pickup - 10 - 5 = 45 min from now
    const expectedMs = pickup.getTime() - (ept + 5) * 60_000;
    expect(Math.abs(activation.getTime() - expectedMs)).toBeLessThan(100); // within 100ms
  });

  it('walk-up order (no pickup_time) activates immediately', () => {
    const activation = getActivationTime(null, 10);
    // Should be roughly "now" (within 1 second)
    expect(Math.abs(activation.getTime() - now.getTime())).toBeLessThan(1000);
  });

  it('order with pickup in 60 min, EPT 10 min is NOT yet in window (starts in 45 min)', () => {
    const order = makeOrder({ pickup_time: min(60), ept_minutes: 10 });
    expect(isInActivationWindow(order)).toBe(false);
  });

  it('order with pickup in 12 min, EPT 10 min IS in window (activation was 2 min ago)', () => {
    // activation = 12 - 10 - 5 = -3 min ago → already past
    const order = makeOrder({ pickup_time: min(12), ept_minutes: 10 });
    expect(isInActivationWindow(order)).toBe(true);
  });

  it('order with pickup in 14 min, EPT 10 min is exactly at boundary (14-10-5 = -1 = active)', () => {
    const order = makeOrder({ pickup_time: min(14), ept_minutes: 10 });
    expect(isInActivationWindow(order)).toBe(true);
  });

  it('order with pickup in 20 min, EPT 10 min is NOT in window (20-10-5 = 5 min future)', () => {
    const order = makeOrder({ pickup_time: min(20), ept_minutes: 10 });
    expect(isInActivationWindow(order)).toBe(false);
  });

  it('walk-up order (no pickup_time) is always in activation window', () => {
    const order = makeOrder({ pickup_time: null });
    expect(isInActivationWindow(order)).toBe(true);
  });

  it('scheduled order 2 hours away is NOT in window', () => {
    const order = makeOrder({ pickup_time: min(120), ept_minutes: 12 });
    expect(isInActivationWindow(order)).toBe(false);
  });

  it('past pickup_time order is in window (overdue)', () => {
    const order = makeOrder({ pickup_time: min(-5), ept_minutes: 10 });
    expect(isInActivationWindow(order)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Priority Scoring — Kitchen Queue Ordering
// ─────────────────────────────────────────────────────────────────────────────
describe('Priority scoring — kitchen queue ordering', () => {

  it('DELAYED orders always outrank normal orders', () => {
    const delayed = makeOrder({ order_status: 'DELAYED' });
    const normal  = makeOrder({ order_status: 'PREPARING' });
    expect(calculatePriorityScore(delayed)).toBeGreaterThan(calculatePriorityScore(normal));
  });

  it('orders placed longer ago have higher priority (w1 weight)', () => {
    const old   = makeOrder({ order_time: min(-30) }); // 30 min ago
    const fresh = makeOrder({ order_time: min(-2)  }); // 2 min ago
    expect(calculatePriorityScore(old)).toBeGreaterThan(calculatePriorityScore(fresh));
  });

  it('urgent pickup (5 min away) scores higher than relaxed pickup (50 min away)', () => {
    const urgent  = makeOrder({ pickup_time: min(5)  });
    const relaxed = makeOrder({ pickup_time: min(50) });
    expect(calculatePriorityScore(urgent)).toBeGreaterThan(calculatePriorityScore(relaxed));
  });

  it('quick-prep item (2 min EPT) scores better than long-prep (20 min EPT)', () => {
    const quick = makeOrder({ ept_minutes: 2  });
    const slow  = makeOrder({ ept_minutes: 20 });
    expect(calculatePriorityScore(quick)).toBeGreaterThan(calculatePriorityScore(slow));
  });

  it('walk-up order (no pickup_time) has reasonable default urgency of 30', () => {
    const walkUp    = makeOrder({ pickup_time: null });
    const scheduled = makeOrder({ pickup_time: min(30) });
    // Walk-up gets urgency=30, scheduled at 30 min gets urgency=30 → similar scores
    const diff = Math.abs(calculatePriorityScore(walkUp) - calculatePriorityScore(scheduled));
    expect(diff).toBeLessThan(10); // Within 10 points of each other
  });

  it('score is a number and not NaN for any valid order', () => {
    const orders = [
      makeOrder(),
      makeOrder({ pickup_time: null }),
      makeOrder({ order_status: 'DELAYED' }),
      makeOrder({ ept_minutes: 0 }),
      makeOrder({ order_time: min(-120), pickup_time: min(2) }),
    ];
    for (const order of orders) {
      const score = calculatePriorityScore(order);
      expect(typeof score).toBe('number');
      expect(isNaN(score)).toBe(false);
    }
  });

  it('correctly sorts 3 orders: DELAYED > urgent pickup > normal', () => {
    const orders = [
      { ...makeOrder({ order_status: 'PREPARING', pickup_time: min(30), ept_minutes: 10 }), label: 'normal' },
      { ...makeOrder({ order_status: 'PLACED',    pickup_time: min(5),  ept_minutes: 5  }), label: 'urgent' },
      { ...makeOrder({ order_status: 'DELAYED',   pickup_time: min(20), ept_minutes: 10 }), label: 'delayed' },
    ];
    orders.sort((a, b) => calculatePriorityScore(b) - calculatePriorityScore(a));
    expect(orders[0].label).toBe('delayed');
    expect(orders[1].label).toBe('urgent');
    expect(orders[2].label).toBe('normal');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Delay Detection
// ─────────────────────────────────────────────────────────────────────────────
describe('Delay detection — auto-flagging overdue orders', () => {

  it('PLACED order waiting 16+ min is delayed (threshold: 15 min)', () => {
    const order = makeOrder({
      order_status: 'PLACED',
      order_time:   min(-16), // 16 min ago
    });
    expect(isDelayedOrder(order)).toBe(true);
  });

  it('PLACED order waiting 10 min is NOT delayed yet', () => {
    const order = makeOrder({
      order_status: 'PLACED',
      order_time:   min(-10),
    });
    expect(isDelayedOrder(order)).toBe(false);
  });

  it('ACCEPTED order — delay detection uses different threshold', () => {
    // ACCEPTED threshold is 5 min in state
    // isDelayedOrder checks wait from order_time, not from accepted_time
    // For ACCEPTED, threshold is 15 min total (same as PLACED since order_time is used)
    const recentlyAccepted = makeOrder({
      order_status: 'ACCEPTED',
      order_time:   min(-3),  // placed only 3 min ago
    });
    expect(isDelayedOrder(recentlyAccepted)).toBe(false);
  });

  it('PREPARING order is never auto-delayed by this function (threshold=0)', () => {
    const order = makeOrder({
      order_status: 'PREPARING',
      order_time:   min(-60),
    });
    expect(isDelayedOrder(order)).toBe(false);
  });

  it('COMPLETED orders are never delayed', () => {
    const order = makeOrder({ order_status: 'COMPLETED', order_time: min(-60) });
    expect(isDelayedOrder(order)).toBe(false);
  });

  it('READY orders are never delayed by this function', () => {
    const order = makeOrder({ order_status: 'READY', order_time: min(-60) });
    expect(isDelayedOrder(order)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: Real-world scenario — "Student orders burger for 1:30 PM lunch"
// ─────────────────────────────────────────────────────────────────────────────
describe('Real-world scenario: Scheduled pre-order for lunch', () => {

  it('Order placed at 12:00 for 1:30 PM pickup (EPT 10 min) should NOT be in kitchen yet at 12:30', () => {
    // Now = 12:30 PM
    const simulatedNow = new Date('2026-10-01T12:30:00Z');
    const pickupTime   = new Date('2026-10-01T13:30:00Z'); // 1:30 PM
    const eptMinutes   = 10;

    // Activation = 1:30 PM - 10 min - 5 min buffer = 1:15 PM
    const activation = getActivationTime(pickupTime, eptMinutes);
    const expectedActivation = new Date('2026-10-01T13:15:00Z');

    expect(Math.abs(activation.getTime() - expectedActivation.getTime())).toBeLessThan(100);
    // At 12:30, activation is in the future → NOT in window
    expect(simulatedNow < activation).toBe(true);
  });

  it('Same order should ENTER the queue at 1:15 PM (15 min before pickup)', () => {
    const simulatedNow = new Date('2026-10-01T13:16:00Z'); // 1:16 PM
    const pickupTime   = new Date('2026-10-01T13:30:00Z');
    const eptMinutes   = 10;

    const activation = getActivationTime(pickupTime, eptMinutes);
    expect(simulatedNow >= activation).toBe(true); // Now past activation time
  });

  it('If kitchen accepts at 1:15, food ready ~1:25 — arrives at pickup before 1:30', () => {
    const prepStartTime  = new Date('2026-10-01T13:15:00Z');
    const eptMinutes     = 10;
    const estimatedReady = new Date(prepStartTime.getTime() + eptMinutes * 60_000);
    const pickupTime     = new Date('2026-10-01T13:30:00Z');

    // Food ready at 1:25 PM, pickup at 1:30 PM → 5 min buffer ✓
    expect(estimatedReady < pickupTime).toBe(true);
    const bufferMinutes = (pickupTime.getTime() - estimatedReady.getTime()) / 60_000;
    expect(bufferMinutes).toBeGreaterThanOrEqual(5);
  });
});
