# syntax=docker/dockerfile:1
# Web-console image for the Kubernetes deployment.
#
# Serves the browser console (apps/web) as STATIC assets behind nginx. Unlike the
# other service images this carries no Rust binary and no Playwright/Chromium — it
# is a `vite build` of the SPA copied into an nginx web root. In the cluster the
# edge component routes `/` of the environment's origin to it through the
# Cloudflare Tunnel, behind Cloudflare Access (see deployments/k8s/components/edge);
# it has no public Service of its own.
#
# No runtime configuration. The console carries no service URL: it addresses /api,
# /artifacts and /arena of its own origin, which the edge routes to the services
# (see packages/ui/src/transport/origin-services.ts). Nothing is configured at
# container start: the image is nginx and the static bundle, with no entrypoint
# script and no environment. What a build bakes in is the bundle's business (see
# components/web/overview.md, "Configuration").
#
# The canonical image is built by the Azure pipeline (scripts/ci/service-image.sh)
# on every push to master and staging, natively per architecture, and pushed to the
# Test Cabinet ACR as testcabinet.azurecr.io/tcab-web:<sha>. To build and push it by
# hand instead (from the repo root):
#   docker build -t <registry>/tcab-web:<tag> -f deployments/images/web.Dockerfile .
#   docker push <registry>/tcab-web:<tag>

# ── Build stage ──────────────────────────────────────────────────────────────
# Build the SPA from the repo root so the npm workspace resolves: Vite bundles the
# console's workspace deps (@clockwyrks/ui, @clockwyrks/run-record,
# @clockwyrks/backend-api) from their TypeScript sources, so the whole workspace
# must `npm ci` against the root lockfile. The .dockerignore re-includes exactly the
# slice this needs (the root manifests, every member's package.json, and the
# packages' sources).
FROM docker.io/library/node:24-bookworm-slim AS build
WORKDIR /src
COPY . .
# Deterministic, lockfile-pinned install of the whole workspace, then build the
# web console. run-record, backend-api, run-stats, voxel-runtime, particle-runtime and
# lattice-runtime are built first: the console's `tsc -b` needs the two contract
# packages' compiled types, and the @clockwyrks/ui library it bundles from source
# imports run-stats' `.`/`./rollup` subpaths, voxel-runtime's and particle-runtime's
# `./three` subpaths and lattice-runtime's root (the Lattice renderer and engine),
# whose code and typings only resolve once each package's dist/ exists, so they are
# built explicitly. The npm
# cache is a BuildKit cache mount so re-installs reuse the downloaded tarballs
# across builds instead of refetching every dependency.
RUN --mount=type=cache,target=/root/.npm \
    npm ci \
    && npm run build -w @clockwyrks/run-record \
    && npm run build -w @clockwyrks/backend-api \
    && npm run build -w @clockwyrks/run-stats \
    && npm run build -w @clockwyrks/voxel-runtime \
    && npm run build -w @clockwyrks/particle-runtime \
    && npm run build -w @clockwyrks/lattice-runtime \
    && npm run build -w @clockwyrks/web

# ── Runtime stage ────────────────────────────────────────────────────────────
# nginx-unprivileged: runs as a non-root user (uid 101) and listens on 8080 by
# default — no Linux capabilities, no privileged port. The Deployment (task-2)
# targets this 8080. Pinned to the 1.x line on bookworm.
FROM docker.io/nginxinc/nginx-unprivileged:1-bookworm

# SPA fallback: every unmatched path serves index.html so client-side routes deep
# link correctly (try_files $uri /index.html). Replaces the stock default server.
COPY deployments/images/web/nginx.conf /etc/nginx/conf.d/default.conf

# The built static bundle. Vite emits apps/web/dist/ (index.html, hashed JS/CSS
# and the public/ assets).
COPY --from=build /src/apps/web/dist /usr/share/nginx/html

# The base image's non-root user, named here so the run's user is explicit.
USER 101
EXPOSE 8080
