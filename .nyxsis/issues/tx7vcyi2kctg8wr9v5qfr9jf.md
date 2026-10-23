---
format: nyxsis-issue
version: 3
id: tx7vcyi2kctg8wr9v5qfr9jf
zone: DATA
number: 3
title: Publish through the artifacts and repos services from the backend and the publisher
type: generic
priority: 3
state: done
depends_on:
  - mkwwaowuuf9kuvps1wmow2pi
  - kzyuvjcx8wexztzcrmk3rwpi
created: 2026-10-13T21:13:49.156386456Z
done: 2026-10-23T23:33:52.180129005Z
outcome: |
  The question this issue was blocked on was settled with option 1. The artifacts
  service gained `GET /public?prefix=` and `DELETE /public/{key}`, which admit
  only the shared service token. The listing returns each object's key, size and
  last-modified time; deleting a missing key still answers 204. The backend keeps
  the prune and the reference-sheet discovery, and does both through these routes.
  Both routes are documented in artifacts/overview.md "Routes" and "Auth", and the
  backend pages say they go through them.

  Done:

  - **artifacts** (microservice-artifacts): the two routes are implemented for R2,
    Blob and the in-memory store, with tests.
  - **backend** (crates/backend): `R2Client`, `r2.rs`, hmac/md-5, the deploy hook
    and the GitHub credential are removed. A publish refresh runs in the order the
    results page states:
    1. Mint the short codes.
    2. Write `codes/<code>`.
    3. Call `POST /runs/{id}/publish-media` for each run.
    4. Write the content-addressed documents the listing shows are missing.
    5. Write the generation, then `index.json` last.
    6. Prune stale generations, best effort.

    Ingest discovers reference sheets by listing `media/references/` through the
    artifacts service. Media listings the snapshot no longer reads were removed
    from the store.
  - **short code**: the shortest unclaimed prefix of the run id, at least 8
    characters. It is stored in a new `run_link.code` column (migration
    m20261023_000066) and returned as `links.code` by `GET /runs/{id}`. `RunLinks`
    gained `code` in contracts, and the artifacts and driver tests were updated.
  - **publisher** (microservice-publisher): the sequence is the Pages deploy, then
    `POST {TCAB_REPOS_URL}/runs/{id}/publish` on the repos service. The Job holds
    only the Cloudflare credential, and git and gh are gone from the image. The
    dispatcher (microservice-dispatcher) no longer forwards `TCAB_GITHUB_ORG`.
  - **deployments**: the R2 keys moved to the new `tcab-artifacts-secrets`, read
    only by artifacts. The publisher's `GH_TOKEN` is gone.
    `scripts/ci/sync-secrets.sh` brings the Key Vault Secrets in line with the
    render's keys before every apply, called from pre-deploy.sh and
    deploy-environment.sh. The deployment docs were updated.

  Gates: the backend's Rust gates pass (1484 backend tests), as do `make gate` in
  publisher and dispatcher and the superrepo's k8s, markdownlint, format, docs and
  shell-tests gates. Some failures come from the environment, not the change:

  - cspell checks no files, because the worktree path contains `/.git/`. Run on
    copies of the changed pages, it found 0 issues.
  - One served-build browser test in contracts times out.
  - One driver bundle test picks up the host's git identity.
  - The engines vitest packages in workspace-test fail to resolve modules.
  - dependency-graph only reorders `[[patch.unused]]`.

  Not verified here, only on staging:

  - a real publish leaving the documents, media, index objects and code object in
    R2;
  - the GitHub push by the repos service;
  - the Key Vault sync against the real CSI driver;
  - that no site build runs.

  The "unpublishing" clause of Verify contradicts results.md "Publish", which
  makes a publish irreversible, so no unpublish route was added.

  Left to open issues: the gallery still reads the dataset at build time, and its
  log line still mentions the deploy hook (SITE, "Serve the gallery from the index
  objects the bucket holds"). The console does not yet build share links from
  `links.code` (SITE, "Add the share control for a published run to the console").
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

## Blocked

With the backend's R2 credential gone (backend/overview.md "The public
dataset", backend/snapshot.md "Writing through the artifacts service": the
backend writes only with `PUT /public/{key}` and
`POST /runs/{id}/publish-media`; artifacts/overview.md "Object stores": no
other component holds a bucket credential), two documented behaviours need
bucket operations no documented route provides:

- backend/snapshot.md "Pruning superseded generations": after the cut-over
  the publish lists `snapshots/` and deletes stale generations (list and
  delete in the bucket).
- backend/results.md "Script references (asset generation)": the backend
  discovers reference sheets by listing `media/references/` at ingest
  (today through `R2Client` in `crates/backend/src/api/ingest_api.rs`).

artifacts/overview.md "Routes" and "Auth" document no route that lists or
deletes public keys.

The user must decide:

1. Does the artifacts service gain public routes for these, for example
   `GET /public?prefix=` (list) and `DELETE /public/{key}`, under the
   service token, with the backend keeping the prune and discovery logic?
2. Or does the artifacts service own them itself, for example a
   `POST /public/prune` taking the live generation and retention, and a
   listing route for reference frames only?
3. Or does reference discovery stop listing the bucket at all (for example
   the CLI's `publish-asset-reference` reports the frames to the backend),
   and only pruning needs a route?

The chosen routes then go into artifacts/overview.md "Routes" and "Auth",
and step 2 of the plan (removing the backend's R2 credential) follows them.
