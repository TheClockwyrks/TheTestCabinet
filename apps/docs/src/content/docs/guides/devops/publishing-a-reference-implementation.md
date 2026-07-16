---
title: Publishing a Reference Implementation
---

A [reference implementation](/components/core/results/#reference-implementations) is
the authored, in-repo, *correct* static build of a test-case variant — the answer
key rather than a model's attempt. It is authored under the case's version folder
(by convention `reference-impl/<variant>/`), declared by a variant's optional
[`reference_implementation`](/testing/end-to-end/manifests/) key, and shown on the
case page's **Reference** tab. Unlike a run's playable build it is **never seeded**
into a run — handing a model the answer would defeat the case — so it is deployed
**out-of-band by a person**, which is what this guide covers.

`tcab publish-reference` builds each targeted variant's reference project with the
case's own [`[build]` commands](/testing/end-to-end/manifests/), scrubs the output
with the same [secret-redaction](/components/core/results/#secret-redaction) pass
the run publisher uses, deploys the static build to the reference Cloudflare Pages
project for the environment you name (see [`--env`](#choose-an-environment)), and
reads the served URL back from `wrangler` (Cloudflare truncates long subdomains, so
the URL is parsed, never constructed).

It then **records that URL in a committed lockfile** — it does *not* push it to the
backend. This is a **pull** model: the prod/staging backends are private (VPN-only)
and can't be pushed to, so the deployed URL is written into
`test-cases/reference-builds.lock.json`, committed, and the backend picks it up by
**ingesting its own git checkout** — the same pull path
[`scripts/reingest-cluster.sh`](#refresh-the-backend) that refreshes catalog edits.
So publishing a reference is three operator steps: **deploy** (`tcab
publish-reference`), **commit + push** the lockfile, and **re-ingest**.

## Which cases get a reference

Only case types with a [`[build]` table](/testing/end-to-end/manifests/) — today
the [end-to-end](/testing/end-to-end/overview/) and
[full-stack](/testing/full-stack/overview/) types — can have a *buildable*
reference implementation. Asset-generation, adversarial, and performance cases
produce no playable build, so `publish-reference` refuses them (a case with no
`[build]` table is a hard error), and they are outside this policy.

**Release gate.** A reference implementation is only published for a
**non-experimental** case — one *without* `experimental = true` in its
[manifest](/testing/end-to-end/manifests/). Experimental cases are
still being iterated on, are hidden from the catalog, and never have their runs
published, so publishing an answer key for one would be premature. The
corresponding obligation is that **every reference-capable case must have a
reference implementation by the time the release that makes it non-experimental
goes live** — a case graduating from experimental to public in a release ships
with its answer key or the release is not ready. Treat "the case is non-experimental
in this release" and "the case has a recorded reference build" as a single gate,
verified before the release goes out.

## Prerequisites

Building and deploying is all `tcab publish-reference` needs — it never talks to the
backend, so there is **no login, token, or backend URL** to configure:

- **`wrangler` on `PATH`**, authenticated with `CLOUDFLARE_API_TOKEN` (a token
  carrying the *Cloudflare Pages: Edit* permission) and `CLOUDFLARE_ACCOUNT_ID`
  for the account that owns the Pages project. The command shells out to
  `wrangler pages deploy`.
- **Node / npm**, so the case's `[build]` install and build commands run.
- **The target Cloudflare Pages project must exist** — `test-cabinet-references`
  for prod, `test-cabinet-references-staging` for staging. Each is a Direct Upload
  project created once in the Cloudflare dashboard; see
  [Releasing → Reference implementations](/development/releasing/#reference-implementations-cloudflare-pages-one-time).
- **A checkout you can commit and push** — the deployed URL lands in
  `test-cases/reference-builds.lock.json`, which you commit.
- For the [re-ingest](#refresh-the-backend), an authenticated `az` (the same
  requirement as [`scripts/reingest-cluster.sh`](/development/running/)), run from a
  VPN/az machine.

## Choose an environment

`--env` is **required** and has no default, so a publish can never silently target
prod — the same convention the operator shell scripts (e.g.
`scripts/upload-subscription-creds.sh`) use for their `--env`. It selects two things
in lockstep:

- `--env prod` → deploys to the `test-cabinet-references` project and records under
  the `prod` key of the lockfile.
- `--env staging` → deploys to `test-cabinet-references-staging` and records under
  the `staging` key.

The single committed lockfile holds a URL **per environment** (prod and staging
deploy to different Pages projects, so a variant has a different URL in each). Each
backend reads only its own environment's key — selected by its `TCAB_ENV` — when it
ingests, so one file correctly serves both.

## Publish

Resolve and print the plan first — the targeted variants, their reference-impl
directories, and the branch alias each would deploy under — without building,
deploying, or recording anything (and needing none of the credentials above):

```sh
tcab publish-reference --env prod <slug> [<version>] --dry-run
```

Then publish for real. With no selector it publishes **every variant that declares
a reference** for the resolved version; `<version>` defaults to the case's
**newest** version when omitted:

```sh
tcab publish-reference --env prod carom                    # all variants, newest version
tcab publish-reference --env prod carom v1.1.0             # all variants, that version
tcab publish-reference --env prod carom v1.1.0 --variant base   # exactly one variant
tcab publish-reference --env staging carom --all-variants  # explicit default, to staging
```

`--variant X` targets exactly one variant and **errors if that variant declares no
reference** — an explicit target with nothing to publish is surfaced, not silently
skipped. Over a multi-variant sweep, one variant's failure is reported and counted
but does not abort the rest; the command exits non-zero if any variant failed, so a
sweep still makes progress and a partial failure is never silent.

For each targeted variant the command:

1. Runs the case's `[build]` **install** then **build** from the reference-impl
   directory, producing the static site in the same `dist/`, `build/`, or `out/`
   a run's build uses.
2. Scrubs the built tree with the run publisher's secret-redaction pass.
3. Deploys it to the `--env` project under the branch alias
   `<slug>-<version-with-dots-as-dashes>-<variant>` (for example
   `carom-v1-1-0-base`) and reads the served URL back from `wrangler`.
4. Writes that URL into `test-cases/reference-builds.lock.json` under the `--env`
   key. Existing entries (other environments, cases, and versions) are preserved,
   and a re-deploy overwrites the variant's URL in place.

The lockfile write is the only side effect that outlives the command; the URL does
not reach any backend until you re-ingest.

## Refresh the backend

Commit the lockfile and push it to the branch the target environment tracks
(`master` for prod, `staging` for staging), then re-ingest so the backend reads it:

```sh
git add test-cases/reference-builds.lock.json
git commit -m "chore(references): record carom reference builds for prod"
git push
scripts/reingest-cluster.sh --env prod
```

The re-ingest [`git fetch`es the backend's checkout and forces a
re-ingest](/development/running/); the backend then loads the lockfile, reads the
entries for **its own `TCAB_ENV`**, and reconciles its `case_reference_build` table
to match — upserting each URL and pruning any it no longer lists (the lockfile is
the source of truth). The version's API response and the public snapshot then carry
each variant's `referenceBuild` URL, and the case page shows the **Reference** tab.
Nothing is pushed *to* the backend at any point; it only ever reads its own checkout.

A **missing** lockfile (not committed yet) or an environment **absent** from it
leaves the table untouched — the backend never wipes references just because the
file has not caught up.

## From CI

The same flow is wired as an on-demand GitHub Actions job,
`.github/workflows/publish-reference.yml` (`workflow_dispatch`), so the build +
deploy + lockfile commit happen off your machine. **The target environment is derived
from the branch** — dispatch it on `master` to publish prod, on `staging` to publish
staging; any other branch is refused. Its inputs are `slug` (required), `version`
(blank = newest), and `variant` (blank = every variant that declares a reference). It
needs only `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (no backend secrets),
builds and deploys, then **commits and pushes the lockfile** back to the branch. It
does **not** re-ingest — that step is still yours to run (it needs VPN/az access the
runner does not have), so after the workflow pushes, run
`scripts/reingest-cluster.sh --env <env>`. A `publish-reference` concurrency group
serializes runs.

## Reference implementation vs. reference mockup

Do not confuse a reference *implementation* with a `[[reference]]` **visual
mockup**. A mockup is a rendered screenshot of a single view that *is* seeded into
the run as a target the model builds toward; a reference implementation is the
whole playable game, is never seeded, and is deployed and shown as a live build.
The distinction is spelled out in
[Results → Reference implementations](/components/core/results/#reference-implementations).
