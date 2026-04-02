// ═══════════════════════════════════════
// AUTH MODULE  (auth.js)
// Shared by index.html, dashboard.html, editor.html
// Uses Supabase Auth with Google OAuth provider
// Maintains full compatibility with drive.js and dashboard.html
// ═══════════════════════════════════════

const SUPABASE_URL     = 'https://pcmskqbkhvuryruvznie.supabase.co';
const SUPABASE_ANON    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjbXNrcWJraHZ1cnlydXZ6bmllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMjQyNjYsImV4cCI6MjA5MDcwMDI2Nn0.6-EQYZIfEZqE_jdqqPIb30H86bby_1sGjTy3R9vgKO8';

// ── Global variables expected by dashboard.html, editor.html, drive.js ──
let appAccessToken = null;   // Google OAuth access token → used by Drive API
let appProfile     = null;   // { name, email, given_name, picture }
let appFolderId    = null;   // cached Drive folder ID
let _supabase      = null;   // Supabase client instance

// ── Init Supabase client ─────────────────────────────────────────
function _initSupabase() {
  if (_supabase) return _supabase;
  if (typeof supabase === 'undefined') {
    console.error('Supabase SDK not loaded');
    return null;
  }
  _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  return _supabase;
}

// ── Sign in with Google (one click, no double login) ─────────────
async function appSignIn() {
  const sb = _initSupabase();
  if (!sb) { showToast('Auth not ready, please refresh', '❌', 'toast-info', 3000); return; }

  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: 'https://www.googleapis.com/auth/drive.file',
      redirectTo: window.location.origin + '/dashboard.html',
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      }
    }
  });

  if (error) {
    showToast('Sign-in failed: ' + error.message, '❌', 'toast-info', 4000);
  }
}

// ── Sign out ─────────────────────────────────────────────────────
async function appSignOut() {
  const sb = _initSupabase();
  if (sb) await sb.auth.signOut();
  appAccessToken = null;
  appProfile     = null;
  appFolderId    = null;
  try {
    sessionStorage.removeItem('ov_token');
    sessionStorage.removeItem('ov_profile');
  } catch(e) {}
  window.location.href = 'index.html';
}

// ── Restore session from Supabase ─────────────────────────────────
// Returns true if a valid session exists
async function restoreSession() {
  const sb = _initSupabase();
  if (!sb) return false;

  const { data: { session }, error } = await sb.auth.getSession();
  if (error || !session) return false;

  _applySession(session);
  return true;
}

// ── Extract Google token + profile from Supabase session ─────────
function _applySession(session) {
  if (!session) return;

  // provider_token is the Google OAuth access token — used directly by Drive API
  appAccessToken = session.provider_token || null;

  const u = session.user;
  const meta = u?.user_metadata || {};

  appProfile = {
    name:       meta.full_name  || meta.name  || 'Doctor',
    email:      u?.email        || '',
    given_name: meta.given_name || (meta.full_name || 'Doctor').split(' ')[0],
    picture:    meta.avatar_url || meta.picture || null,
  };

  // Cache for fast access (same pattern as original auth.js)
  try {
    if (appAccessToken) {
      const expiry = session.expires_at ? session.expires_at * 1000 : Date.now() + 3500000;
      sessionStorage.setItem('ov_token',   JSON.stringify({ token: appAccessToken, expiry }));
      sessionStorage.setItem('ov_profile', JSON.stringify(appProfile));
    }
  } catch(e) {}

  // Push token into Drive module if already loaded
  syncTokenToGD();
}

// ── Push token into GD Drive module ──────────────────────────────
function syncTokenToGD() {
  if (typeof GD !== 'undefined' && GD._setToken && appAccessToken) {
    GD._setToken(appAccessToken, appProfile);
  }
}

// ── onSignedIn: called after session confirmed ────────────────────
// Each page overrides this function to do its own post-login work
function onSignedIn(profile) {
  window.location.href = 'dashboard.html';
}

// ── Handle OAuth redirect (called on page load after redirect) ────
async function _handleAuthRedirect() {
  const sb = _initSupabase();
  if (!sb) return false;

  // Supabase automatically handles the URL hash/code on load
  const { data: { session }, error } = await sb.auth.getSession();
  if (error || !session) return false;

  _applySession(session);
  onSignedIn(appProfile);
  return true;
}

// ── Listen for session changes (token refresh etc.) ───────────────
function _startSessionListener() {
  const sb = _initSupabase();
  if (!sb) return;

  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      if (session) _applySession(session);
    }
    if (event === 'SIGNED_OUT') {
      appAccessToken = null;
      appProfile     = null;
      appFolderId    = null;
    }
  });
}

// ── Auto-init on script load ──────────────────────────────────────
(function() {
  // Wait for DOM + Supabase SDK
  function init() {
    _initSupabase();
    _startSessionListener();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
