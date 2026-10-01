// tests/order-workflow.test.js
// Unit Tests — EPT Engine, Queue Priority, Status Transition State Machine
// No database required — pure logic tests

import { describe, it, expect } from 'vitest';
import { calculatePriorityScore } from '../src/services/queue.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: EPT Calculation Logic (without DB)
// ─────────────────────────────────────────────────────────────────────────────
describe('EPT calculation logic', () => {

  function simulateEPT(orderItems, activeOrders = 0) {
    if (!orderItems || orderItems.length === 0) return 5;

    const sorted = [...orderItems].sort(
      (a, b) => (b.preparation_time * b.quantity) - (a.preparation_time * a.quantity)
    );
    const [longest, ...rest] = sorted;
    let baseEpt = longest.preparation_time * Math.min(longest.quantity, 3);
    for (const item of rest) {
      baseEpt += item.preparation_time * 0.5;
    }
    const workloadMultiplier = Math.min(1 + 0.15 * activeOrders, 2.0);
    return Math.ceil(baseEpt * workloadMultiplier);
  }

  it('single item: returns preparation_time × quantity (capped at 3×)', () => {
    const result = simulateEPT([{ preparation_time: 10, quantity: 1 }]);
    expect(result).toBe(10);
  });

  it('single item × 5 qty: caps multiplier at 3×', () => {
    const result = simulateEPT([{ preparation_time: 10, quantity: 5 }]);
    expect(result).toBe(30); // 10 × min(5,3) = 30
  });

  it('two items: longest sets base, second adds 50% overlap', () => {
    const result = simulateEPT([
      { preparation_time: 10, quantity: 1 }, // burger: 10 min (longest)
      { preparation_time: 2,  quantity: 1 }, // drink:  2 min → adds 1 min
    ]);
    expect(result).toBe(11); // 10 + (2 × 0.5) = 11
  });

  it('three items: correct parallel overlap calculation', () => {
    const result = simulateEPT([
      { preparation_time: 12, quantity: 1 }, // pasta: 12 min (longest)
      { preparation_time: 5,  quantity: 2 }, // fries: 10 → 2.5 min extra
      { preparation_time: 1,  quantity: 1 }, // drink: 0.5 min extra
    ]);
    expect(result).toBe(Math.ceil(12 + 5 * 0.5 + 1 * 0.5)); // 12+2.5+0.5 = 15
  });

  it('busy kitchen (5 active orders) slows EPT by 1.75× (capped at 2×)', () => {
    const baseResult = simulateEPT([{ preparation_time: 10, quantity: 1 }], 0);
    const busyResult = simulateEPT([{ preparation_time: 10, quantity: 1 }], 5);
    expect(busyResult).toBeGreaterThan(baseResult);
    expect(busyResult).toBe(Math.ceil(10 * Math.min(1 + 0.15 * 5, 2.0)));
  });

  it('workload multiplier is hard-capped at 2× (extremely busy kitchen)', () => {
    const extremeResult = simulateEPT([{ preparation_time: 10, quantity: 1 }], 100);
    expect(extremeResult).toBe(20); // 10 × 2.0 cap
  });

  it('empty order returns default 5 min EPT', () => {
    expect(simulateEPT([])).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Queue Priority Scoring
// ─────────────────────────────────────────────────────────────────────────────
describe('Queue priority scoring', () => {
  const now = new Date();

  function makeOrder(overrides = {}) {
    return {
      order_time:   new Date(now.getTime() - 10 * 60_000), // placed 10 min ago
      pickup_time:  new Date(now.getTime() + 30 * 60_000), // pickup in 30 min
      order_status: 'ACCEPTED',
      ept_minutes:  10,
      ...overrides,
    };
  }

  it('an order placed longer ago scores higher than a fresh order', () => {
    const older  = makeOrder({ order_time: new Date(now.getTime() - 30 * 60_000) });
    const newer  = makeOrder({ order_time: new Date(now.getTime() - 2  * 60_000) });
    expect(calculatePriorityScore(older)).toBeGreaterThan(calculatePriorityScore(newer));
  });

  it('an order with closer pickup time scores higher', () => {
    const urgent  = makeOrder({ pickup_time: new Date(now.getTime() + 5  * 60_000) });
    const relaxed = makeOrder({ pickup_time: new Date(now.getTime() + 60 * 60_000) });
    expect(calculatePriorityScore(urgent)).toBeGreaterThan(calculatePriorityScore(relaxed));
  });

  it('DELAYED orders receive a significant priority boost (+30)', () => {
    const normal  = makeOrder({ order_status: 'ACCEPTED' });
    const delayed = makeOrder({ order_status: 'DELAYED' });
    // DelayFlag adds w3 × 100 = 0.3 × 100 = 30 points
    expect(calculatePriorityScore(delayed) - calculatePriorityScore(normal)).toBeCloseTo(30, 0);
  });

  it('quick-prep items get a slight efficiency advantage (lower penalty)', () => {
    const quickOrder = makeOrder({ ept_minutes: 2  });
    const slowOrder  = makeOrder({ ept_minutes: 20 });
    expect(calculatePriorityScore(quickOrder)).toBeGreaterThan(calculatePriorityScore(slowOrder));
  });

  it('order with no pickup_time still gets a valid score', () => {
    const order = makeOrder({ pickup_time: null });
    const score = calculatePriorityScore(order);
    expect(typeof score).toBe('number');
    expect(isNaN(score)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Status Transition State Machine
// ─────────────────────────────────────────────────────────────────────────────
describe('Order status transition state machine', () => {

  const TRANSITIONS = {
    PLACED:    ['ACCEPTED', 'REJECTED', 'CANCELLED'],
    ACCEPTED:  ['PREPARING', 'DELAYED', 'CANCELLED'],
    PREPARING: ['READY', 'DELAYED', 'CANCELLED'],
    READY:     ['COLLECTED', 'NOT_COLLECTED'],
    COLLECTED: ['COMPLETED'],
    DELAYED:   ['PREPARING', 'READY', 'CANCELLED'],
    COMPLETED:     [],
    CANCELLED:     [],
    REJECTED:      [],
    NOT_COLLECTED: [],
  };

  function canTransition(from, to) {
    return (TRANSITIONS[from] || []).includes(to);
  }

  // Valid happy-path transitions
  it('PLACED → ACCEPTED is valid', () => expect(canTransition('PLACED', 'ACCEPTED')).toBe(true));
  it('ACCEPTED → PREPARING is valid', () => expect(canTransition('ACCEPTED', 'PREPARING')).toBe(true));
  it('PREPARING → READY is valid', () => expect(canTransition('PREPARING', 'READY')).toBe(true));
  it('READY → COLLECTED is valid', () => expect(canTransition('READY', 'COLLECTED')).toBe(true));
  it('COLLECTED → COMPLETED is valid', () => expect(canTransition('COLLECTED', 'COMPLETED')).toBe(true));

  // Cancellation paths
  it('PLACED → CANCELLED is valid (pre-prep cancellation)', () => expect(canTransition('PLACED', 'CANCELLED')).toBe(true));
  it('ACCEPTED → CANCELLED is valid', () => expect(canTransition('ACCEPTED', 'CANCELLED')).toBe(true));

  // Delay paths
  it('ACCEPTED → DELAYED is valid', () => expect(canTransition('ACCEPTED', 'DELAYED')).toBe(true));
  it('DELAYED → READY is valid (delay resolved)', () => expect(canTransition('DELAYED', 'READY')).toBe(true));
  it('DELAYED → CANCELLED is valid', () => expect(canTransition('DELAYED', 'CANCELLED')).toBe(true));

  // INVALID transitions
  it('PLACED → READY is INVALID (must go through ACCEPTED)', () => expect(canTransition('PLACED', 'READY')).toBe(false));
  it('PLACED → COMPLETED is INVALID', () => expect(canTransition('PLACED', 'COMPLETED')).toBe(false));
  it('COMPLETED → CANCELLED is INVALID (terminal state)', () => expect(canTransition('COMPLETED', 'CANCELLED')).toBe(false));
  it('CANCELLED → PREPARING is INVALID (no resurrection)', () => expect(canTransition('CANCELLED', 'PREPARING')).toBe(false));
  it('COLLECTED → PLACED is INVALID (backwards transition)', () => expect(canTransition('COLLECTED', 'PLACED')).toBe(false));
  it('PREPARING → PLACED is INVALID (backwards transition)', () => expect(canTransition('PREPARING', 'PLACED')).toBe(false));
  it('READY → ACCEPTED is INVALID (backwards transition)', () => expect(canTransition('READY', 'ACCEPTED')).toBe(false));

  // Not-collected edge case
  it('READY → NOT_COLLECTED is valid (uncollected past window)', () => expect(canTransition('READY', 'NOT_COLLECTED')).toBe(true));
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: Slot Capacity Guard
// ─────────────────────────────────────────────────────────────────────────────
describe('Pickup slot capacity enforcement', () => {

  function checkSlotCapacity(slot) {
    if (slot.status === 'FULL') return { allowed: false, error: 'Slot is full' };
    if (slot.current_orders >= slot.max_orders) return { allowed: false, error: 'Slot at capacity' };
    return { allowed: true };
  }

  it('allows order when slot has capacity', () => {
    const slot = { max_orders: 20, current_orders: 10, status: 'AVAILABLE' };
    expect(checkSlotCapacity(slot).allowed).toBe(true);
  });

  it('blocks order when slot is marked FULL', () => {
    const slot = { max_orders: 20, current_orders: 20, status: 'FULL' };
    expect(checkSlotCapacity(slot).allowed).toBe(false);
  });

  it('blocks order when current_orders equals max_orders', () => {
    const slot = { max_orders: 20, current_orders: 20, status: 'AVAILABLE' };
    expect(checkSlotCapacity(slot).allowed).toBe(false);
  });

  it('blocks order when current_orders exceeds max_orders', () => {
    const slot = { max_orders: 5, current_orders: 6, status: 'AVAILABLE' };
    expect(checkSlotCapacity(slot).allowed).toBe(false);
  });

  it('allows last slot before capacity', () => {
    const slot = { max_orders: 20, current_orders: 19, status: 'AVAILABLE' };
    expect(checkSlotCapacity(slot).allowed).toBe(true);
  });
});
