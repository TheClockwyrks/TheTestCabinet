# Task 5 — Publisher image + CI

**Status:** ⬜ Not started. Depends on task-3 (the crate must exist to build).

## Goal

Build and publish the `tcab-publisher` service image, with the tooling the release
needs that the driver image lacks (`gh`, `wrangler`).

## Image (`deployments/images/publisher.Dockerfile`)

Model on `deployments/images/driver.Dockerfile` (`node:24-bookworm-slim`, builds
its crate from source in a cargo stage, slim runtime, runs unprivileged). Beyond
the driver's `git`, add:

- **`gh`** (GitHub CLI) — for `gh repo view` / `gh repo create --push`.
- **`wrangler`** — Cloudflare's CLI for `wrangler pages deploy`. It's an npm
  package; the base is already Node, so `npm i -g wrangler` (pin a version) or
  invoke via `npx --yes wrangler`. Decide one and pin it.
- **`git`** (as the driver image installs it).
- **No** Playwright/Chromium (the publisher renders nothing) — drop that layer.

Entrypoint `tcab-publisher`. Keep it self-contained (no host mounts).

## CI (`.github/workflows/build-service-images.yml`)

Add `tcab-publisher` to the build matrix alongside the other five service images
(`tcab-backend`, `tcab-auth-service`, `tcab-dispatcher`, `tcab-driver`,
`tcab-artifacts`), publishing `ghcr.io/<owner>/tcab-publisher` tagged `:latest` and
`:<git-sha>`. Update the workflow header comment's image list.

## Operator follow-ups (NOT code — handled in the follow-up session)

- Kick off the workflow so the image is built, then **set the new
  `tcab-publisher` GHCR package to Public** (same one-time step the other service
  packages needed), so the cluster can pull it without a pull secret.
- Pin the overlay to the published `:<git-sha>` (task-6) once it's built.

## Out of scope

Wiring the image into the overlay/dispatcher env (task-6 / task-2).
