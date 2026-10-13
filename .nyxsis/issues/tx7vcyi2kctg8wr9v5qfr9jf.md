---
format: nyxsis-issue
version: 2
id: tx7vcyi2kctg8wr9v5qfr9jf
zone: DATA
number: 3
title: Publish through the artifacts and repos services from the backend and the publisher
type: generic
state: open
depends_on:
  - mkwwaowuuf9kuvps1wmow2pi
  - kzyuvjcx8wexztzcrmk3rwpi
created: 2026-10-13T21:13:49.156386456Z
---

A publish snapshots the dataset into R2 from the backend, triggers a site
deploy hook, and the publisher Job pushes the run's repository from a tree it
reads itself. The documentation has the backend write the public dataset
through the artifacts service in one order, mint the run's short code, and
have the publisher Job call the repos service for the public push, with no
site rebuild: `apps/docs/src/content/docs/components/backend/results.md`,
section "Publish", `apps/docs/src/content/docs/components/backend/snapshot.md`,
sections "Writing through the artifacts service", "Atomic swap" and "Short
codes", and `apps/docs/src/content/docs/components/repos/overview.md`,
section "Publishing".

## What is missing

- The backend's snapshot writer composing the run document, the media copy,
  the index objects and `codes/<code>` and writing each through the artifacts
  service's routes, in the order the results page states, with the pointer
  swap last.
- The short code minted as the snapshot page's "Short codes" section states,
  stored on the run and returned by the API as
  `apps/docs/src/content/docs/components/backend/api.md` states.
- The publisher Job's sequence as the results page states: the Pages deploy
  of the playable build and the repos service's publish route, holding only
  the Cloudflare credential.
- The deploy hook and the backend's direct R2 and GitHub credentials gone.

## Verify

Publishing a run on staging leaves its document, media, index objects and
code object in the public bucket, the public repository on GitHub, and no
site build; unpublishing removes the run from the index objects; `make gate`
passes in the backend and publisher checkouts.
