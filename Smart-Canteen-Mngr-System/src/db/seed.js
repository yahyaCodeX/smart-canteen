// src/db/seed.js
// Hackathon Demo Seed Script
// Wipes users table and inserts 4 guaranteed demo accounts (one per role)
// Run: npm run seed

import bcrypt from 'bcryptjs';
import pool from './pool.js';

const DEMO_PASSWORD = 'demo123';
const SALT_ROUNDS = 10;

const DEMO_USERS = [
  {
    name: 'Alex Customer',
    email: 'customer@demo.com',
    role: 'CUSTOMER',
  },
  {
    name: 'Sam Staff',
    email: 'staff@demo.com',
    role: 'STAFF',
  },
  {
    name: 'Maria Manager',
    email: 'manager@demo.com',
    role: 'MANAGER',
  },
  {
    name: 'Admin User',
    email: 'admin@demo.com',
    role: 'ADMIN',
  },
];

const DEMO_MENU_ITEMS = [
  { item_name: 'Classic Burger', category: 'Burgers', price: 450, available_quantity: 50, preparation_time: 10, image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=500&q=60', description: 'Juicy beef patty with lettuce, tomato & special sauce' },
  { item_name: 'Cheese Pizza (Slice)', category: 'Pizza', price: 300, available_quantity: 40, preparation_time: 8, image: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=500&q=60', description: 'Fresh mozzarella on house-made tomato sauce' },
  { item_name: 'Chicken Wrap', category: 'Wraps', price: 350, available_quantity: 35, preparation_time: 7, image: 'https://images.unsplash.com/photo-1626700051175-6818013e1d4f?auto=format&fit=crop&w=500&q=60', description: 'Grilled chicken with avocado, cucumber & yogurt sauce' },
  { item_name: 'Veggie Bowl', category: 'Healthy', price: 400, available_quantity: 30, preparation_time: 6, image: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=500&q=60', description: 'Seasonal roasted vegetables over quinoa' },
  { item_name: 'French Fries', category: 'Sides', price: 200, available_quantity: 80, preparation_time: 5, image: 'https://images.unsplash.com/photo-1576107232684-1279f390859f?auto=format&fit=crop&w=500&q=60', description: 'Crispy golden fries with sea salt' },
  { item_name: 'Coca-Cola (Can)', category: 'Drinks', price: 100, available_quantity: 100, preparation_time: 1, image: 'https://images.unsplash.com/photo-1629203851122-3726ecdf080e?auto=format&fit=crop&w=500&q=60', description: 'Classic Coca-Cola 330ml can' },
  { item_name: 'Fresh Orange Juice', category: 'Drinks', price: 250, available_quantity: 25, preparation_time: 3, image: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?auto=format&fit=crop&w=500&q=60', description: 'Freshly squeezed orange juice' },
  { item_name: 'Chocolate Brownie', category: 'Desserts', price: 150, available_quantity: 20, preparation_time: 2, image: 'https://images.unsplash.com/photo-1564355808539-22fda35bed7e?auto=format&fit=crop&w=500&q=60', description: 'Rich dark chocolate brownie with nuts' },
  { item_name: 'Pasta Carbonara', category: 'Mains', price: 500, available_quantity: 15, preparation_time: 12, image: 'https://images.unsplash.com/photo-1612874742237-6526221588e3?auto=format&fit=crop&w=500&q=60', description: 'Classic carbonara with pancetta and parmesan' },
  { item_name: 'Meal Deal: Burger + Fries + Drink', category: 'Combos', price: 650, available_quantity: 25, preparation_time: 12, image: 'https://images.unsplash.com/photo-1594212699903-ec8a3eca50f5?auto=format&fit=crop&w=500&q=60', description: 'Classic burger combo — best value deal' },
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🌱 Starting database seed...\n');

    // ─── 1. Wipe existing data (in safe order respecting FKs) ───────────────
    console.log('🗑️  Clearing existing data...');
    await client.query('DELETE FROM order_items');
    await client.query('DELETE FROM orders');
    await client.query('DELETE FROM idempotency_cache');
    await client.query('DELETE FROM staff_activity_logs');
    await client.query('DELETE FROM users');
    await client.query('DELETE FROM menu_items');
    await client.query('DELETE FROM pickup_slots');
    console.log('   ✓ All tables cleared.\n');

    // ─── 2. Seed demo users ─────────────────────────────────────────────────
    console.log('👤 Seeding demo users...');
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, SALT_ROUNDS);

    for (const user of DEMO_USERS) {
      const result = await client.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         RETURNING user_id, name, email, role`,
        [user.name, user.email, passwordHash, user.role]
      );
      const created = result.rows[0];
      console.log(`   ✓ [${created.role.padEnd(8)}] ${created.email}  (id: ${created.user_id})`);
    }
    console.log('');

    // ─── 3. Seed menu items ─────────────────────────────────────────────────
    console.log('🍔 Seeding menu items...');
    for (const item of DEMO_MENU_ITEMS) {
      await client.query(
        `INSERT INTO menu_items
           (item_name, category, price, available_quantity, preparation_time, image, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [item.item_name, item.category, item.price, item.available_quantity, item.preparation_time, item.image, item.description]
      );
      console.log(`   ✓ ${item.item_name} (${item.category}) — $${item.price}`);
    }
    console.log('');

    // ─── 4. Seed pickup slots (next 8 hours in 15-min intervals) ─────────────
    console.log('⏰ Seeding pickup slots (next 8 hours in 15-min windows)...');
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0); // Round up to next 15-min

    for (let i = 0; i < 32; i++) {
      const slotTime = new Date(now.getTime() + i * 15 * 60 * 1000);
      await client.query(
        `INSERT INTO pickup_slots (slot_time, max_orders, current_orders)
         VALUES ($1, $2, 0)`,
        [slotTime.toISOString(), 20]
      );
    }
    console.log('   ✓ 32 pickup slots created (next 8 hours).\n');

    await client.query('COMMIT');

    console.log('─────────────────────────────────────────────────');
    console.log('✅ Seed completed successfully!\n');
    console.log('🔑 Demo Credentials (password: demo123)');
    console.log('─────────────────────────────────────────────────');
    console.log('  customer@demo.com  → CUSTOMER role');
    console.log('  staff@demo.com     → STAFF role');
    console.log('  manager@demo.com   → MANAGER role');
    console.log('  admin@demo.com     → ADMIN role');
    console.log('─────────────────────────────────────────────────');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Seed failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
