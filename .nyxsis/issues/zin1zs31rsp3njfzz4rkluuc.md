---
format: nyxsis-issue
version: 3
id: zin1zs31rsp3njfzz4rkluuc
zone: SITE
number: 3
title: Add the share control for a published run to the console
type: generic
priority: 3
state: done
depends_on:
  - tx7vcyi2kctg8wr9v5qfr9jf
created: 2026-10-13T21:14:22.512234207Z
done: 2026-10-26T07:19:45.481965809Z
outcome: |
  The console now has a share control for a published run, as the web overview's
  "Sharing a published run" section describes.

  - **ui-common** (`d2b84e2b`): `runShareLinks` (`app/data/share-links.ts`) builds
    `<origin>/r/<code>` and `<origin>/p/<code>` from the record's `links.code` and
    the share origin. It returns null when either is missing. `useLiveGallery`
    takes `{ shareOrigin }`, which becomes the optional
    `GalleryDataInput.shareOrigin`. `RunDetailLayout` puts `RunShareControl` in
    the header's control strip. The control is an icon button that opens a panel
    showing both links, each with a Copy button that reads "Copied" or "Copy
    failed". The panel closes on Escape or a click outside. The copy goes through
    `navigator.clipboard`, which the client shell already routes through itself,
    so the shell needed no change. The public gallery and the Spec Cabinet pass no
    origin, so they show no control.
  - **console.testcabinet.ai** (`8106f75`): passes
    `import.meta.env.VITE_SHARE_ORIGIN` to `useLiveGallery`. The Dockerfile
    already sets it.

  Verified: ui-common's `make gate` passes (3428 tests) except `cspell`. That gate
  checks 0 files in this worktree because the worktree's path is under `.git/`,
  and it passes in the main checkout. The console passes `build`, `typecheck`, the
  jsdom suite (run from a copy outside `.git/`, because Vite will not serve files
  under `.git/`) and every other gate, `web-lint` and `web-browser-test` among
  them. Its `typescript` gate was not run: the Azure Artifacts feed token in the
  devcontainer is invalid (E401).

  Left: the console pins `@clockwyrks/ui` 0.1.3, so the control reaches a console
  image only after ui-common is released and the console's pin moves to that
  release. The staging check (each copied link resolves through `tcab.ai`, and an
  unpublished run shows no control) waits on that deploy.
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
