---
title: Publishing a Reference Implementation
---

## Overview

A [reference implementation](/components/core/results/#reference-implementations)
is the authored, in-repo, correct static build of a test-case variant on one
[engine](/components/core/engines/). It is authored under the case's version
folder (by convention `references/<engine>/<variant>/`), declared by a variant's
optional `reference_implementation` key, and offered from the case page's Play
tab. It is kept out of every run's seed, so it is deployed out-of-band by a
person.

The unit both commands here work in is the variant-on-an-engine pair, because the
build a reference demonstrates differs under each engine: an engineless one
carries its own runtime, an engine-backed one hands the same surfaces to the
engine it is built on. A variant supporting two engines therefore has two reference
builds, each deployed and recorded on its own, and the case page's Play tab
launches the one recorded for the page's anchored engine.

`tcab publish-reference` builds each targeted reference project with
the case's own [`[build]` commands](/testing/end-to-end/manifests/), scrubs the
output with the same
[secret-redaction](/components/core/results/#secret-redaction) pass the run
publisher uses, deploys the static build to the reference Cloudflare Pages
project for the named environment, and reads the served URL back from `wrangler`.
Cloudflare truncates long subdomains, so the URL is parsed from `wrangler`'s
output rather than constructed.

The command then records that URL in a committed lockfile. Staging and production
backends are private and cannot be pushed to, so the deployed URL is written into
`test-cases/reference-builds.lock.json`, committed, and picked up when the
backend ingests its own git checkout. Publishing a reference is therefore three
operator steps: deploy, commit and push the lockfile, and re-ingest.

## Reference forms

`publish-reference` targets the variants that declare a
`reference_implementation`, and such a reference takes one of two publishable
forms. A third form is published by nothing at all, and so takes none of the
operator steps above; see [Bundled references](#bundled-references).

### Buildable references

A case type with a [`[build]` table](/testing/end-to-end/manifests/) has a
reference that is a static web project, built with the case's own `[build]`
commands and deployed to Cloudflare Pages. That covers the
[end-to-end](/testing/end-to-end/overview/) and
[full-stack](/testing/full-stack/overview/) types. A case with no `[build]` table
is a hard error on this path.

### Script references

An [asset-generation](/testing/asset-generation/overview/) case declares no
`[build]` table and produces no site. Its output is a recorded action log per
frame, and its reference is a
[`draw.sh`](/testing/asset-generation/manifests/overview/) of drawing-binary
calls that `publish-reference` runs, uploading the produced frames to the public
snapshot bucket. See [Asset-generation references](#asset-generation-references).

### Bundled references

The [performance](/testing/performance/overview/) type's Reference tab is real,
but nothing publishes it. Its reference is the case's scored factories played
through the reference engine, and both the engine and the scenarios ship inside
the UI bundle; see
[The Reference tab](/testing/performance/lattice/architecture/#the-reference-tab).
There is no deploy, no lockfile entry, and no re-ingest: the tab appears wherever
the console does, including the static site, as soon as the build ships. Refresh
it the way you refresh any vendored asset, by regenerating it in the case bundle,
re-running `node scripts/vendor-lattice-assets.mjs`, and committing the result.

A bundled reference cannot outrun its case. The release gate below exists because
a deployed reference is live on the internet the moment it is published, whatever
the catalog says, so publishing one for a case nobody can see would leak an answer
key early. A bundled reference has no such window: it renders only on the
case-detail page, so it is visible exactly when the case is. An experimental case
is hidden from the catalog and refuses to resolve, so it never accumulates a
published run, so it never enters the public snapshot, which emits only versions
that have one, and a case absent from the snapshot has no page for the tab to sit
on. A bundled reference satisfies the gate structurally rather than being waived
from it.

One thing does ship ahead of the case. The vendored scenarios are statically
imported, so the bundler emits them into every build, including the public site's,
whether or not the catalog carries the case, and they are fetchable by URL. That
is deliberate and harmless here, because the same files are already in the public
repository, as is the engine that plays them. Weigh it before vendoring anything
into the bundle that must stay unpublished.

### Release gate

A reference implementation is published for a non-experimental case, one without
`experimental = true` in its [manifest](/testing/end-to-end/manifests/). The
corresponding obligation is that every reference-capable case has a reference
implementation by the time the release that makes it non-experimental goes live.
Treat "the case is non-experimental in this release" and "the case has a recorded
reference build" as a single gate, verified before the release goes out.

## Prerequisites

`tcab publish-reference` never talks to the backend, so there is no login, token,
or backend URL to configure:

- `wrangler` on `PATH`, authenticated with `CLOUDFLARE_API_TOKEN` (a token
  carrying the Cloudflare Pages: Edit permission) and `CLOUDFLARE_ACCOUNT_ID` for
  the account that owns the Pages project. The command shells out to
  `wrangler pages deploy`.
- Node and npm, so the case's `[build]` install and build commands run.
- The repository's npm workspace installed and its packages built, with
  `npm ci && npm run build:packages` at the repository root. An engine-backed
  reference resolves its engine from `packages/<slug>/` by a relative `file:`
  path, so the built package must exist before the reference is built. The same
  holds for `tcab capture-baselines`, which builds the same reference.
- The target Cloudflare Pages project: `test-cabinet-references` for production,
  `test-cabinet-references-staging` for staging. Each is a Direct Upload project
  created once in the Cloudflare dashboard; see
  [Releasing](/development/releasing/#reference-implementations-cloudflare-pages-one-time).
- A checkout you can commit and push, for the lockfile.
- For the [re-ingest](#refresh-the-backend), an authenticated `az`, run from a
  machine with cluster access.

## Choose an environment

`--env` is required and has no default, so a publish can never silently target
production. It selects two things in lockstep:

- `--env prod` deploys to the `test-cabinet-references` project and records under
  the `prod` key of the lockfile.
- `--env staging` deploys to `test-cabinet-references-staging` and records under
  the `staging` key.

The single committed lockfile holds a URL per environment. Each backend reads
only its own environment's key, selected by its `TCAB_ENV`, so one file serves
both.

## Publish

Resolve and print the plan first: the targeted variant/engine pairs, their
reference-impl directories, the baseline directory each would rewrite, and the
branch alias each would deploy under. `--dry-run` builds, deploys, and records
nothing, and needs none of the credentials above:

```sh
tcab publish-reference --env prod <slug> [<version>] --dry-run
```

Then publish for real. With no selector it publishes every reference the resolved
version declares, one per variant per engine, and `<version>` defaults to the
case's newest version:

```sh
tcab publish-reference --env prod carom                        # every reference, newest
tcab publish-reference --env prod carom v3.0.0                 # every reference, that version
tcab publish-reference --env prod carom v3.0.0 --variant base  # one variant, every engine
tcab publish-reference --env prod carom v3.0.0 --engine none   # one engine, every variant
tcab publish-reference --env staging carom --all-variants      # explicit default, to staging
```

`--variant X` targets exactly one variant and errors when that variant declares
no reference. `--engine Y` narrows to one engine and errors when the case does not
support it, or when no targeted variant published for it. Over a sweep, one
failure is reported and counted while the rest proceed, and the command exits
non-zero when any failed.

For each targeted reference the command:

1. Runs the case's `[build]` install then build from the reference-impl
   directory, producing the static site in the same `dist/`, `build/`, or `out/`
   a run's build uses.
2. Re-captures the variant's committed baseline validation media from that build,
   unless `--skip-baselines` is passed. See
   [Baseline validation media](#baseline-validation-media).
3. Scrubs the built tree with the run publisher's secret-redaction pass.
4. Deploys it to the `--env` project under the branch alias
   `<slug>-<version-with-dots-as-dashes>-<variant>-<engine>` (for example
   `carom-v3-0-0-base-simple-2d`) and reads the served URL back from `wrangler`.
   The engine reaches the alias because a variant's two builds are two deploys.
5. Writes that URL into `test-cases/reference-builds.lock.json` under the `--env`
   key, at `<slug>` → `<version>` → `<variant>` → `<engine>`. Entries for other
   environments, cases, versions, and engines are preserved, and a re-deploy
   overwrites that one URL in place.

The lockfile write and the baseline media are the only side effects that outlive
the command.

## Baseline validation media

A case that declares [instrumentation](/testing/end-to-end/instrumentation/)
pairs some review items with automated validation. Per run, validation runs it
against the model's build to capture the actual media. The baseline half of the
reviewer's side-by-side is the same thing run against the reference
implementation. The reference implementation is a fixed property of the case
version, so that media is captured once and committed under
`<version>/validation-baseline/<engine>/<variant>/` — keyed by engine because a
variant has one reference implementation per engine, and a run is only
comparable against the one it was itself built on.

Capturing it is an authoring step rather than a publishing step. It needs no
Cloudflare credentials and no deployment environment:

```sh
tcab capture-baselines <slug> [<version>] [--variant base] [--engine none] [--dry-run]
```

Run it whenever you add or change a validator, or change the reference
implementation it runs against, and commit the result. Its case, version,
variant, and engine selection is identical to `publish-reference`'s. The whole
`validation-baseline/<engine>/<variant>/` directory is regenerated, so a renamed
or removed output never lingers as a stale committed file.

A case that declares its validators per engine has its baseline recorded by
running those in-process [vitest suites](/components/core/validation/) against
the reference implementation, exactly as a run's own media is recorded by
running them against the model's build. A case that declares browser scripts
instead has its reference build served and driven. The path is chosen the same
way in both places, so the two panes a reviewer compares always come from the
same scenario driven the same way.

`publish-reference` performs the same capture as part of each build,
and does it before the deploy so a failed capture never leaves a deployed build
paired with stale media. When the baselines are known to be current for this
build, `--skip-baselines` deploys without re-capturing:

```sh
tcab publish-reference --env prod carom --skip-baselines
```

That is an optimization: driving every script in a browser dominates the
command's runtime.

## Refresh the backend

Commit the lockfile and push it to the branch the target environment tracks
(`master` for production, `staging` for staging), then re-ingest:

```sh
git add test-cases/reference-builds.lock.json
git commit -m "chore(references): record carom reference builds for prod"
git push
scripts/reingest-cluster.sh --env prod
```

The re-ingest
[fetches the backend's checkout and forces a re-ingest](/development/running/).
The backend then loads the lockfile, reads the entries for its own `TCAB_ENV`,
and reconciles its `case_reference_build` table to match, upserting each URL and
pruning any it no longer lists. The version's API response and the public
snapshot then carry each variant's `referenceBuilds`, keyed by engine, and the
case page's Play tab offers the build.

A lockfile that is missing, or an environment absent from it, leaves the table
untouched.

## Asset-generation references

An [asset-generation](/testing/asset-generation/overview/) case's reference is a
script. It is the same `tcab publish-reference` command, with the same `--env`
requirement and the same variant selectors, and enough of the flow differs to
read separately.

For each targeted variant the command seeds a scratch workspace from the case
manifest, then runs `reference-impl/<variant>/draw.sh` in it with the case's
drawing binary on `PATH`. That seeding is the same one a real run gets, so the
canvas size and declared frames come from the manifest. Every declared frame's
rendered image and recorded action log is uploaded to the public snapshot bucket:

```text
media/references/<slug>/<version>/<variant>/frames/<index>.png
media/references/<slug>/<version>/<variant>/frames/<index>.actions.json
```

The log is uploaded beside the image because the log is what an asset-generation
run is [scored on](/testing/asset-generation/evaluation/).

This path takes its own prerequisites:

- The target environment's R2 credentials: `TCAB_R2_ACCOUNT_ID`,
  `TCAB_R2_BUCKET`, `TCAB_R2_ACCESS_KEY_ID`, and `TCAB_R2_SECRET_ACCESS_KEY`.
  These address the same public snapshot bucket the backend writes. `--env`
  selects the deployment rather than the bucket, so supply the credentials for
  the environment you named. The command echoes the bucket it is about to write.
- The drawing binary, resolved from `TCAB_ASSET_BIN_DIR`, else the cargo target
  directory's `release/`, else `PATH`. Build it first (for example
  `cargo build --release -p test-cabinet-draw`); when it cannot be found the
  command fails naming every location it tried.

R2 keys are constructible, so this path keeps no lockfile: the backend learns
which references exist by listing the `media/references/` prefix at ingest and
reconciling its `case_reference_sheet` table. The flow is one step shorter:

```sh
tcab publish-reference --env prod <slug>    # runs the script, uploads the frames
scripts/reingest-cluster.sh --env prod      # backend rediscovers them
```

Re-running the command after editing a script overwrites the objects in place,
which is the whole update path, and is why the images and the logs stay out of
version control.

When the backend has no R2 configuration, the reconcile is skipped rather than
reconciling to empty, mirroring how a missing lockfile leaves the build table
untouched.

## From CI

The same flow is wired as an on-demand GitHub Actions job,
`.github/workflows/publish-reference.yml` (`workflow_dispatch`), so the build,
deploy, and lockfile commit happen off your machine. The target environment is
derived from the branch: dispatch it on `master` to publish production, on
`staging` to publish staging. Any other branch is refused.

Its inputs are `slug` (required), `version` (blank = newest), and `variant`
(blank = every variant that declares a reference). It needs only
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, builds and deploys, then
commits and pushes the lockfile back to the branch. Re-ingest is left to the
operator, so run `scripts/reingest-cluster.sh --env <env>` after the workflow
pushes. A `publish-reference` concurrency group serializes runs.

## Reference implementation and reference mockup

A `[[reference]]` visual mockup is a rendered screenshot of a single view that is
seeded into the run as a target the model builds toward. A reference
implementation is the whole playable build, is kept out of the seed, and is
deployed and shown as a live build. See
[Results](/components/core/results/#reference-implementations).
