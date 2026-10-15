---
format: nyxsis-issue
version: 2
id: bximf02l2ruk0sz93tdznm8b
zone: EDGE
number: 3
title: Point the console and tcab at the edge with Access credentials
type: generic
state: open
depends_on:
  - nxs3up9tm7pi706lpgt12xkm
  - ey5sbl6cm5bcwy5uvykmi6d1
created: 2026-10-13T21:12:31.974188466Z
---

The console is served with a backend URL and signs in with the backend's own
login, and `tcab` logs in the same way. The documentation makes the console
same-origin with every service it uses, served at `/` of the environment's
origin from the `tcab-web` image, and has `tcab` present an Access credential:
`apps/docs/src/content/docs/components/web/overview.md`, sections "Service
dependencies", "Configuration" and "Deployment", and
`apps/docs/src/content/docs/development/running.md`, section "Pointing `tcab`
at a deployment".

## What is missing

- The console addressing `/api/`, `/artifacts/` and `/arena/` relative to its
  origin, carrying no service URL, with the Vite dev server proxying the three
  to the forwarded services as the running page states.
- `tcab` reading the Access variables the running page and the CLI page's
  "Authentication" section name, sending a user token or a service token as
  the edge expects, and the login, logout and register commands gone.
- The Grafana link derived from the console's hostname as
  `apps/docs/src/content/docs/development/observability.md` states.

## Verify

On staging the console loads at the origin with no cross-origin request, a run
is launched and reviewed from it, and `tcab ingest` against the origin
succeeds with the service token and is refused without one.
