const { createClient } = require('@supabase/supabase-js');

// Supabase replaces the old SQLite connection as the app's SQL store.
// Like the SQLite handle it supersedes, the client is exposed on `global.db`
// so callers reach it the same way. Credentials are optional: if they are not
// configured the app still boots and every Mongo-backed feature works, exactly
// as it did when the SQLite file was missing.
let client = null;

function initSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.warn('⚠️ Supabase not configured (set SUPABASE_URL and SUPABASE_SERVICE_KEY) - SQL layer disabled');
    return null;
  }

  try {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    console.log('✅ Supabase client initialised:', url);
    return client;
  } catch (error) {
    console.error('❌ Supabase init error:', error.message);
    return null;
  }
}

// Verifies credentials actually work. Any response that is not a transport
// error means we reached the project, so an unknown-table error still counts.
async function verifySupabase() {
  if (!client) return false;

  try {
    const { error } = await client.from('_healthcheck').select('*').limit(1);

    if (error && /fetch failed|network|ENOTFOUND|ECONNREFUSED/i.test(error.message)) {
      console.error('❌ Supabase unreachable:', error.message);
      return false;
    }

    console.log('✅ Supabase reachable');
    return true;
  } catch (error) {
    console.error('❌ Supabase verification failed:', error.message);
    return false;
  }
}

function getSupabase() {
  return client;
}

module.exports = { initSupabase, verifySupabase, getSupabase };
