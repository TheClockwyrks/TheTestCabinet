# syntax=docker/dockerfile:1
# Web-console image for the Kubernetes deployment.
#
# Serves the browser console (apps/web) as STATIC assets behind nginx. Unlike the
# other service images this carries no Rust binary and no Playwright/Chromium — it
# is a `vite build` of the SPA copied into an nginx web root. The in-cluster
# internal-ingress component fronts it at the private console hostname (see
# deployments/k8s/components/internal-ingress and tasks/context.md); it is never
# exposed publicly.
#
# Runtime config, NOT a build-time bake. CI builds ONE tcab-web:<git-sha> image
# shared by every overlay (mirroring tcab-publisher), so the backend/auth URLs
# cannot be inlined per-environment via Vite's build-time VITE_* vars. Instead the
# entrypoint `envsubst`s /config.js from TCAB_WEB_BACKEND_URL / TCAB_WEB_AUTH_URL
# at container start; the console reads window.__TCAB_CONFIG__ from that file
# before it boots (see apps/web/index.html + apps/web/src/state/useConnections.ts).
# Both default to empty, so an unset env yields a valid (empty) config that leaves
# the console unconfigured rather than broken.
#
# The canonical image is published to GHCR by the build-service-images.yml GitHub
# Actions workflow (as ghcr.io/<owner>/tcab-web, tagged :latest and :<git-sha>) on
# every push to master that touches the web sources or this Dockerfile. To build
# and push it by hand instead (from the repo root):
#   docker build -t <registry>/tcab-web:<tag> -f deployments/images/web.Dockerfile .
#   docker push <registry>/tcab-web:<tag>

# ── Build stage ──────────────────────────────────────────────────────────────
# Build the SPA from the repo root so the npm workspace resolves: Vite bundles the
# console's workspace deps (@test-cabinet/ui, @test-cabinet/run-record) from their
# TypeScript sources, so the whole workspace must `npm ci` against the root
# lockfile. The .dockerignore re-includes exactly the slice this needs (the root
# manifests, every member's package.json, and the three packages' sources).
FROM docker.io/library/node:24-bookworm-slim AS build
WORKDIR /src
COPY . .
# Deterministic, lockfile-pinned install of the whole workspace, then build just
# the web console. The npm cache is a BuildKit cache mount so re-installs reuse the
# downloaded tarballs across builds instead of refetching every dependency.
RUN --mount=type=cache,target=/root/.npm \
    npm ci \
    && npm run build -w @test-cabinet/web

# ── Runtime stage ────────────────────────────────────────────────────────────
# nginx-unprivileged: runs as a non-root user (uid 101) and listens on 8080 by
# default — no Linux capabilities, no privileged port. The Deployment (task-2)
# targets this 8080. Pinned to the 1.x line on bookworm.
FROM docker.io/nginxinc/nginx-unprivileged:1-bookworm

# SPA fallback: every unmatched path serves index.html so client-side routes deep
# link correctly (try_files $uri /index.html). Replaces the stock default server.
COPY deployments/images/web/nginx.conf /etc/nginx/conf.d/default.conf

# The built static bundle. Vite emits apps/web/dist/ (index.html, hashed JS/CSS,
# the public/ assets including the placeholder config.js the entrypoint overwrites).
COPY --from=build /src/apps/web/dist /usr/share/nginx/html

# Runtime config injector. The base image runs every executable script under
# /docker-entrypoint.d/ before starting nginx; ours envsubst's /config.js from the
# environment. gettext-base supplies envsubst (not in the slim base by default).
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends gettext-base \
  && rm -rf /var/lib/apt/lists/*
COPY deployments/images/web/config.js.template /etc/nginx/templates/config.js.template
COPY deployments/images/web/30-render-config.sh /docker-entrypoint.d/30-render-config.sh
RUN chmod +x /docker-entrypoint.d/30-render-config.sh

# Drop back to the base image's non-root user for the actual run.
USER 101
EXPOSE 8080
