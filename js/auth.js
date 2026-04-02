// ═══════════════════════════════════════
// AUTH MODULE (auth.js) — Firebase version
// Shared by index.html, dashboard.html, editor.html
// Uses Firebase Auth with Google OAuth provider
// Maintains full compatibility with drive.js and dashboard.html
// ═══════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAtn5K4EVtwKZy4FX2KQ_7adUs2HmtGrRs",
  authDomain: "app.orthotimes.net",
  projectId: "orthovision-492112",
  storageBucket: "orthovision-492112.firebasestorage.app",
  messagingSenderId: "450970102800",
  appId: "1:450970102800:web:f3b933db5ff5e286c6ee95"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.file');
provider.setCustomParameters({ access_type: 'offline', prompt: 'consent' });

// ── Global variables expected by dashboard.html, editor.html, drive.js ──
window.appAccessToken = null;
window.appProfile     = null;
window.appFolderId    = null;

// ── Sign in with Google ───────────────────────────────────────────
async function appSignIn() {
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    _applySession(result.user, credential.accessToken);
    window.location.href = 'dashboard.html';
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      if (typeof showToast === 'function') {
        showToast('Sign-in failed: ' + err.message, '❌', 'toast-info', 4000);
      }
    }
  }
}

// ── Sign out ─────────────────────────────────────────────────────
async function appSignOut() {
  await signOut(auth);
  window.appAccessToken = null;
  window.appProfile     = null;
  window.appFolderId    = null;
  try {
    sessionStorage.removeItem('ov_token');
    sessionStorage.removeItem('ov_profile');
  } catch(e) {}
  window.location.href = 'index.html';
}

// ── Restore session on page load ──────────────────────────────────
// Returns true if a valid session with a Drive token exists
function restoreSession() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) { resolve(false); return; }

      // Try cached token first (avoids popup on every page load)
      const cached = _loadCachedToken();
      if (cached) {
        _applySession(user, cached);
        resolve(true);
        return;
      }

      // No cached token — need a fresh one via popup
      try {
        const result = await signInWithPopup(auth, provider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        _applySession(result.user, credential.accessToken);
        resolve(true);
      } catch(e) {
        // Popup blocked/closed — user needs to sign in manually
        resolve(false);
      }
    });
  });
}

// ── Apply session data ────────────────────────────────────────────
function _applySession(user, accessToken) {
  window.appAccessToken = accessToken;
  window.appProfile = {
    name:       user.displayName || 'Doctor',
    email:      user.email || '',
    given_name: (user.displayName || 'Doctor').split(' ')[0],
    picture:    user.photoURL || null,
  };

  try {
    if (accessToken) {
      sessionStorage.setItem('ov_token',
        JSON.stringify({ token: accessToken, expiry: Date.now() + 3500000 })
      );
      sessionStorage.setItem('ov_profile', JSON.stringify(window.appProfile));
    }
  } catch(e) {}

  syncTokenToGD();
}

// ── Load cached Drive token from sessionStorage ───────────────────
function _loadCachedToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem('ov_token'));
    if (t && t.expiry > Date.now()) return t.token;
  } catch(e) {}
  return null;
}

// ── Push token into Drive module if loaded ────────────────────────
function syncTokenToGD() {
  if (typeof GD !== 'undefined' && GD._setToken && window.appAccessToken) {
    GD._setToken(window.appAccessToken, window.appProfile);
  }
}

// ── Expose everything globally ────────────────────────────────────
window.appSignIn      = appSignIn;
window.appSignOut     = appSignOut;
window.restoreSession = restoreSession;
window.syncTokenToGD  = syncTokenToGD;
