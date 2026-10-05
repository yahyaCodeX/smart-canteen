// src/utils/supabase.js
// Supabase client — single instance used across the entire frontend.
// All authentication and database queries go through this client.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables. Check your frontend .env file.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

export default supabase;
