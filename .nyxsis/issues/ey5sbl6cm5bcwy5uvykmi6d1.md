---
format: nyxsis-issue
version: 2
id: ey5sbl6cm5bcwy5uvykmi6d1
zone: EDGE
number: 2
title: Verify the Access assertion in the services and retire accounts
type: generic
state: done
created: 2026-10-13T21:11:26.138577549Z
done: 2026-10-19T01:18:05.80599113Z
---

The backend keeps its own accounts, registration, login and minted user
tokens. The documentation makes the identity the edge asserts the one identity
of every call, verified by the backend, artifacts and arena services:
`apps/docs/src/content/docs/components/auth/overview.md`.

## What is missing

- The assertion check in the three services, configured as the page's
  "Configuration" section states, with the local overlay's unset audience
  attributing every mutation to the local identity.
- The in-cluster tokens the dispatcher, driver and publisher present, kept as
  the page's "In-cluster callers" section states.
- The account tables, the registration and login routes, the user-minted
  tokens and `GET /config`, removed from the backend and its API, with a
  migration that drops what they stored. The API page is
  `apps/docs/src/content/docs/components/backend/api.md`.

## Verify

On the local overlay a console mutation is attributed to `dev@local`. On
staging, behind the edge from EDGE-1, a run launched from the console records
the signed-in email, and a call that reaches the backend with no assertion is
refused. `make gate` passes in the backend's checkout.
