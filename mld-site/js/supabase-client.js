// Initialize Supabase client — must load after config.js
const { createClient } = supabase;
window.db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
