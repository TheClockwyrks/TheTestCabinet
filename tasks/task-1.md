# Task 1 — `tcab-web` image + runtime console config

**Status:** ⬜ Not started. This is the foundation — the in-cluster console artifact +
its env-driven config. No dependency on the other tasks; do it first.

## Goal

Package the web console (`apps/web`) as a static container image (`tcab-web`) that an
in-cluster Deployment can serve, and make the running console take its **backend + auth
URLs from runtime env** (not a build-time bake) so one image works for every environment.

## Why runtime config (not `VITE_BACKEND_URL` at build)

CI builds a single `tcab-web:<git-sha>` image shared by all overlays (exactly like
`tcab-publisher`). The console today reads the backend URL from `VITE_BACKEND_URL`
(build-time, inlined by Vite) or localStorage (`apps/web/src/state/useConnections.ts`).
Baking a prod URL into the shared image would break staging. Instead, inject the URLs at
container start.

## App change (`apps/web`)

1. **`apps/web/index.html`** — add `<script src="/config.js"></script>` in `<head>` BEFORE
   the module script, so `window.__TCAB_CONFIG__` exists before the app boots.
2. **`apps/web/src/state/useConnections.ts`** — where it currently derives the backend URL
   (localStorage `tcab.web.backendUrl` → `import.meta.env.VITE_BACKEND_URL`) and the auth
   URL (`import.meta.env.VITE_AUTH_URL ?? backendUrl`), insert `window.__TCAB_CONFIG__`
   ahead of the `VITE_*` fallbacks:
   - backend: `localStorage` → `window.__TCAB_CONFIG__?.backendUrl` → `VITE_BACKEND_URL` → "".
   - auth: `window.__TCAB_CONFIG__?.authUrl` → `VITE_AUTH_URL` → `backendUrl`.
   Keep the user-override (settings UI / localStorage) winning over the injected default so
   an operator can still point at a local stack. Add a typed declaration for
   `window.__TCAB_CONFIG__` (`{ backendUrl?: string; authUrl?: string }`).
3. Ship a **default `apps/web/public/config.js`** that sets `window.__TCAB_CONFIG__ = {}`
   (so `vite build` includes a harmless placeholder and local `npm run dev` works unchanged;
   the image overwrites it at runtime).

Run `npm run typecheck` (workspace) after the change.

## Image (`deployments/images/web.Dockerfile`)

Model the multi-stage shape on the other images, but this is a **static-asset** image (no
Rust, no Playwright):

- **Build stage** (`node:24-bookworm-slim`): copy the npm workspace, `npm ci`, then
  `npm run build` for `apps/web` → `apps/web/dist/`. (Confirm the build needs `packages/ui`
  + `packages/run-record` workspaces; build from the repo root so workspace deps resolve,
  as the other node builds do.)
- **Runtime stage** (`nginx:1-bookworm` or `nginxinc/nginx-unprivileged`): copy `dist/` to
  the web root; add an nginx conf with **SPA fallback** (`try_files $uri /index.html;`).
- **Runtime config injection:** an entrypoint that runs `envsubst` over a template into
  `<webroot>/config.js` before nginx starts, e.g. emitting
  `window.__TCAB_CONFIG__ = { backendUrl: "${TCAB_WEB_BACKEND_URL}", authUrl: "${TCAB_WEB_AUTH_URL}" };`
  Default both to empty so an unset env yields a valid (empty) config. Run unprivileged;
  no host mounts.

Decide + pin the nginx base; keep the entrypoint minimal (a tiny shell script, not a
framework). Container listens on a fixed port (e.g. 8080) referenced by the Deployment in
task-2.

## CI (`.github/workflows/build-service-images.yml`)

Add a `tcab-web` entry to the build matrix alongside the other service images, building
`deployments/images/web.Dockerfile` and publishing `ghcr.io/<owner>/tcab-web` tagged
`:latest` and `:<git-sha>`. Update the workflow header comment's image list.

## Operator follow-ups (NOT code)

- Kick off the workflow so the image builds, then set the new `tcab-web` GHCR package to
  **Public** (same one-time step the other service packages needed).
- Pin the overlay to the published `:<git-sha>` (task-3) once built.

## Tests / checks

- `npm run typecheck` green; `vite build` for `apps/web` produces `dist/` with `config.js`.
- Locally: `docker run -e TCAB_WEB_BACKEND_URL=https://api.testcabinet.ai … tcab-web`, then
  `curl localhost:8080/config.js` shows the injected URL, and `/` + a deep link both return
  `index.html` (SPA fallback works).

## Out of scope

The Deployment/Service/Ingress (task-2), overlay wiring (task-3). This task only produces
the image + the runtime-config behavior.
