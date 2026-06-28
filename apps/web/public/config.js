// Runtime console config — default placeholder.
//
// index.html loads this BEFORE the app's module script, so the console can read
// window.__TCAB_CONFIG__ for its backend/auth URLs at boot. This committed copy
// is intentionally EMPTY ({}), so `vite build` ships a harmless default and a
// local `npm run dev` behaves exactly as before (the app falls back to the
// VITE_* build-time vars, then localStorage). The tcab-web container image
// OVERWRITES this file at start, envsubst'ing the real URLs from its environment
// (TCAB_WEB_BACKEND_URL / TCAB_WEB_AUTH_URL). See deployments/images/web.Dockerfile.
window.__TCAB_CONFIG__ = {};
