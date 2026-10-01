// src/db/pool.js
// PostgreSQL connection pool — uses Neon's serverless-compatible pg driver
// The DATABASE_URL from .env already includes ?sslmode=require for Neon

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set. Copy .env.example to .env and fill in your Neon connection string.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Required for Neon free tier SSL
  },
  max: 10,               // Max connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Verify connection on startup
pool.on('connect', () => {
  console.log('✅ Connected to Neon PostgreSQL');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL pool error:', err.message);
});

export default pool;
