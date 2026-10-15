---
format: nyxsis-issue
version: 2
id: zin1zs31rsp3njfzz4rkluuc
zone: SITE
number: 3
title: Add the share control for a published run to the console
type: generic
state: open
depends_on:
  - tx7vcyi2kctg8wr9v5qfr9jf
created: 2026-10-13T21:14:22.512234207Z
---

The console offers no share link for a published run. The documentation
describes a share control that offers the run's `tcab.ai` verdict and play
links, built from the short code the API returns:
`apps/docs/src/content/docs/components/web/overview.md`, section "Sharing a
published run", and `apps/docs/src/content/docs/components/site/overview.md`,
section "Share links".

## What is missing

The share control on a published run's pages in the console, reading the
code from the run's API record and copying either link, with the clipboard
reached through the operator client's shell where the console runs inside
it, as `apps/docs/src/content/docs/components/client/overview.md` states.

## Verify

On staging a published run shows the control, each copied link resolves
through `tcab.ai`, an unpublished run shows none, and `make gate` passes in
the console's checkout.
