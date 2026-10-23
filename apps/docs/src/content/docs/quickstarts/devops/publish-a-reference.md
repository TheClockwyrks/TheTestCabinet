---
title: Publish a Reference
---

## Overview

A test case variant's
[reference implementation](/components/backend/results/#reference-implementations)
is the authored, correct build of the case: the answer key. Publishing one is a
pull flow: deploy the build, commit the lockfile, then re-ingest so the backend
reads it onto the case page's Play tab.

An asset-generation case publishes differently; see
[Asset-generation references](#asset-generation-references). The policy for which
cases get a reference is in the
[full guide](/guides/devops/publishing-a-reference-implementation/).

## Prerequisites

- `wrangler` on `PATH`, with `CLOUDFLARE_API_TOKEN` (Cloudflare Pages: Edit) and
  `CLOUDFLARE_ACCOUNT_ID` set, plus Node and npm for the case's `[build]`
  commands. The deploy contacts no backend.
- For the re-ingest, the environment's Access service token in
  `TCAB_ACCESS_CLIENT_ID` and `TCAB_ACCESS_CLIENT_SECRET`, with
  `TCAB_BACKEND_URL` at the origin's `/api` path; see
  [Sign In](/quickstarts/setup/sign-in/#automation).
- For an engine-backed reference inside the superrepo, the engines workspace
  built and linked (`npm ci && npm run build` in `engines/`, then
  `scripts/repos/link-packages.sh` at the superrepo root); see
  [Reference implementations](/development/building/#reference-implementations).
  `tcab capture-baselines` needs the same.
- The target Pages project exists: `test-cabinet-references` for prod, or
  `test-cabinet-references-staging` for staging. See
  [Releasing](/development/releasing/).
- The case is non-experimental and declares a `[build]` table, which today means
  an end-to-end or full-stack case.

## Publish

```sh
# 1. Deploy and write the lockfile. --env selects the Pages project AND the lock key.
tcab publish-reference --env prod <slug> [<version>] --dry-run     # show the plan first
tcab publish-reference --env prod <slug>                    # newest version, all variants
tcab publish-reference --env prod <slug> <version> --variant base  # exactly one variant

# 2. Commit and push the lockfile in test-suites, then re-ingest so the backend
#    reads it.
git -C test-suites add test-cases/reference-builds.lock.json
git -C test-suites commit -m "chore(references): record <slug>"
git -C test-suites push
tcab ingest --env prod --changed
```

`--env` accepts `prod` or `staging` and is required, so a publish never silently
targets prod. `<version>` defaults to the case's newest version. With no variant
selector, every variant declaring a
[`reference_implementation`](/testing/end-to-end/manifests/) is published;
`--variant <slug>` targets one and errors when that variant declares none, and
`--all-variants` states the default explicitly. A multi-variant sweep reports
per-variant failures and exits non-zero when any failed, after attempting them
all.

A variant has one reference build per [engine](/components/engines/engines/), and
the command targets each pair. It builds the reference, re-captures its committed
[baseline validation media](#baseline-validation-media), scrubs secrets, deploys
to the `--env` Pages project under a `<slug>-<version>-<variant>-<engine>` branch
alias, reads the served URL back from `wrangler`, and writes it into
`test-cases/reference-builds.lock.json` under the `--env` key. `--engine <slug>`
narrows a run to one engine. The backends ingest that lockfile from their
`test-suites` checkout, which is what lands each URL on the variant's
`referenceBuilds` and the case page's Play tab.

## Asset-generation references

An [asset-generation](/testing/asset-generation/manifests/overview/) case
declares no `[build]` table and produces no site, so the same command takes a
different path for it. It needs the environment's Access service token rather
than Cloudflare Pages access, since the frames are written through the
artifacts service:

```sh
# TCAB_BACKEND_URL  TCAB_ACCESS_CLIENT_ID  TCAB_ACCESS_CLIENT_SECRET
tcab publish-reference --env prod <slug> --dry-run   # show the plan and the object keys
tcab publish-reference --env prod <slug>
tcab ingest --env prod --changed
```

It seeds a scratch workspace from the case manifest, runs each variant's
`reference-impl/<variant>/draw.sh` with the case's drawing binary on `PATH`, and
writes every produced frame image and action log to the public bucket through
the artifacts service under `media/references/<slug>/<version>/<variant>/`. The
command echoes the origin it is writing through.

Two differences matter:

- The frames stay out of version control. The object keys are deterministic, so
  the backend discovers what exists by listing that prefix at ingest. Re-running
  the command after editing a script overwrites the objects in place, and
  `tcab ingest --env` still follows.
- The drawing binary comes from your machine. It is resolved from
  `TCAB_ASSET_BIN_DIR`, then the cargo target directory's `release/`, then the
  `tool-sprite` checkout's `target/release/`, then `PATH`. Build it first, for
  example `cargo build --release` in `tool-sprite/`; the command names every
  location it tried when it finds nothing.

To see a reference before publishing it, render it locally:

```sh
node scripts/preview-asset-reference.mjs <slug>
```

That writes the frames, the action logs, and a GIF per sequence to
`tmp/asset-previews/<slug>/<variant>/`, with an `index.html` showing them
together. It needs no credentials and uploads nothing.

## Baseline validation media

A case's baseline [validation](/testing/end-to-end/instrumentation/) media is the
expected-behavior half of a reviewer's side-by-side, with one
`validation-baseline/<engine>/<variant>/` directory per reference build. It is
committed to the `cold-storage` submodule under the version's mirrored path (see
[where baselines live](/components/driver/validation/#where-baselines-live)), so
check the submodule out first. Regenerating it is its own command, needing none
of the credentials above:

```sh
git submodule update --init --depth 1 cold-storage
tcab capture-baselines <slug> [<version>] [--variant base] [--engine none] [--dry-run]
```

Run it whenever a validator or the reference implementation it runs against
changes. It exits non-zero, naming the targets, when a reference build failed or
left a unit that did not run clean against it, so commit only what a clean sweep
wrote. Commit the media in `cold-storage`, push it to that repository's `master`,
then commit the moved submodule pointer here:

```sh
git -C cold-storage switch -C master
git -C cold-storage add test-cases
git -C cold-storage commit -m "feat: recapture <slug> <version> baselines"
git -C cold-storage push origin master
git add cold-storage
```

`publish-reference` re-captures the same media as part of its build and refuses
to deploy a target whose capture failed; `--skip-baselines` deploys without
re-capturing when the committed media is already current.
