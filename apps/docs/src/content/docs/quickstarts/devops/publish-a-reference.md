---
title: Publish a Reference
---

## Overview

A test case variant's
[reference implementation](/components/core/results/#reference-implementations)
is the authored, correct build of the case: the answer key. Publishing one is a
pull flow: deploy the build, commit the lockfile, then re-ingest so the backend
reads it onto the case page's Reference tab.

An asset-generation case publishes differently; see
[Asset-generation references](#asset-generation-references). The policy for which
cases get a reference is in the
[full guide](/guides/devops/publishing-a-reference-implementation/).

## Prerequisites

- `wrangler` on `PATH`, with `CLOUDFLARE_API_TOKEN` (Cloudflare Pages: Edit) and
  `CLOUDFLARE_ACCOUNT_ID` set, plus Node and npm for the case's `[build]`
  commands. The command contacts no backend, so it needs no login or token.
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

# 2. Commit and push the lockfile, then re-ingest so the backend reads it.
git add test-cases/reference-builds.lock.json
git commit -m "chore(references): record <slug>"
git push
scripts/reingest-cluster.sh --env prod
```

`--env` accepts `prod` or `staging` and is required, so a publish never silently
targets prod. `<version>` defaults to the case's newest version. With no variant
selector, every variant declaring a
[`reference_implementation`](/testing/end-to-end/manifests/) is published;
`--variant <slug>` targets one and errors when that variant declares none, and
`--all-variants` states the default explicitly. A multi-variant sweep reports
per-variant failures and exits non-zero when any failed, after attempting them
all.

A variant has one reference build per [engine](/components/core/engines/), and
the command targets each pair. It builds the reference, re-captures its committed
[baseline validation media](#baseline-validation-media), scrubs secrets, deploys
to the `--env` Pages project under a `<slug>-<version>-<variant>-<engine>` branch
alias, reads the served URL back from `wrangler`, and writes it into
`test-cases/reference-builds.lock.json` under the `--env` key. `--engine <slug>`
narrows a run to one engine. The backends ingest that lockfile from their own git
checkout, which is what lands each URL on the variant's `referenceBuilds` and the
Reference tab.

## Asset-generation references

An [asset-generation](/testing/asset-generation/manifests/overview/) case
declares no `[build]` table and produces no site, so the same command takes a
different path for it. It needs the target environment's R2 credentials rather
than Cloudflare Pages access:

```sh
# TCAB_R2_ACCOUNT_ID  TCAB_R2_BUCKET  TCAB_R2_ACCESS_KEY_ID  TCAB_R2_SECRET_ACCESS_KEY
tcab publish-reference --env prod <slug> --dry-run   # show the plan and the object keys
tcab publish-reference --env prod <slug>
scripts/reingest-cluster.sh --env prod
```

It seeds a scratch workspace from the case manifest, runs each variant's
`reference-impl/<variant>/draw.sh` with the case's drawing binary on `PATH`, and
uploads every produced frame image and action log to the public snapshot bucket
under `media/references/<slug>/<version>/<variant>/`. The command echoes the
bucket it is writing to.

Two differences matter:

- The frames stay out of version control. The object keys are deterministic, so
  the backend discovers what exists by listing that prefix at ingest. Re-running
  the command after editing a script overwrites the objects in place, and
  `reingest-cluster.sh` still follows.
- The drawing binary comes from your machine. It is resolved from
  `TCAB_ASSET_BIN_DIR`, then the cargo target directory's `release/`, then
  `PATH`. Build it first, for example
  `cargo build --release -p test-cabinet-draw`; the command names every location
  it tried when it finds nothing.

To see a reference before publishing it, render it locally:

```sh
node scripts/preview-asset-reference.mjs <slug>
```

That writes the frames, the action logs, and a GIF per sequence to
`tmp/asset-previews/<slug>/<variant>/`, with an `index.html` showing them
together. It needs no credentials and uploads nothing.

## Baseline validation media

A case's committed baseline
[validation](/testing/end-to-end/instrumentation/) media lives in
`validation-baseline/<engine>/<variant>/` — one directory per reference build —
and is the expected-behavior half of a reviewer's side-by-side. Regenerating it
is its own command, needing none of the credentials above:

```sh
tcab capture-baselines <slug> [<version>] [--variant base] [--engine none] [--dry-run]
```

Run it whenever a validator or the reference implementation it runs against
changes, then commit the result. `publish-reference` re-captures the same media as part of
its build; `--skip-baselines` deploys without re-capturing when the committed
media is already current.

## From CI

The `publish-reference.yml` workflow (`workflow_dispatch`) builds, deploys, and
commits the lockfile. The environment is derived from the branch it is dispatched
on: `master` publishes prod and `staging` publishes staging. Run
`scripts/reingest-cluster.sh` afterwards.
