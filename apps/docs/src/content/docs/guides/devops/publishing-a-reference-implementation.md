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

The one command is `tcab publish-reference`. It builds each targeted variant's
reference project with the case's own [`[build]` commands](/testing/end-to-end/manifests/),
scrubs the output with the same [secret-redaction](/components/core/results/#secret-redaction)
pass the run publisher uses, deploys the static build to the reference Cloudflare
Pages project for the environment you name (see [`--env`](#choose-an-environment)),
reads the served URL back from `wrangler` (Cloudflare truncates long subdomains, so
the URL is parsed, never constructed), and records it on the backend so the
Reference tab can embed it. This mirrors the run publisher — see
[Publishing a Test Run Result](/guides/devops/publishing-a-test-run-result/) for the
run-build analogue.

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

Publishing a reference needs the same hosting + auth the run publisher's operator
half needs (see [CLI Authentication](/components/cli/overview/#authentication)):

- **`wrangler` on `PATH`**, authenticated with `CLOUDFLARE_API_TOKEN` (a token
  carrying the *Cloudflare Pages: Edit* permission) and `CLOUDFLARE_ACCOUNT_ID`
  for the account that owns the Pages project. The command shells out to
  `wrangler pages deploy`.
- **Node / npm**, so the case's `[build]` install and build commands run.
- **A logged-in account** (`tcab login`) or a `TCAB_TOKEN` override, and
  **`TCAB_BACKEND_URL`** pointing at the backend for the environment you publish
  to (see [`--env`](#choose-an-environment)). Recording goes through the same
  bearer auth as the ingest/publish write paths.
- **The target Cloudflare Pages project must exist** — `test-cabinet-references`
  for prod, `test-cabinet-references-staging` for staging. Each is a Direct Upload
  project created once in the Cloudflare dashboard; see
  [Releasing → Reference implementations](/development/releasing/#reference-implementations-cloudflare-pages-one-time).

## Choose an environment

`--env` is **required** and has no default, so a publish can never silently target
prod — the same convention the operator shell scripts (e.g.
`scripts/upload-subscription-creds.sh`) use for their `--env`. It selects the
Cloudflare Pages project the build deploys to:

- `--env prod` → the `test-cabinet-references` project.
- `--env staging` → the `test-cabinet-references-staging` project.

It selects **only** the Pages project. The deployed URL is recorded against
whatever `TCAB_BACKEND_URL`/`TCAB_TOKEN` point at, so when publishing staging
references, point those at the staging backend — otherwise a staging build's URL
lands in the prod catalog.

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
4. `PUT`s that URL to the backend's authenticated reference-build endpoint, which
   upserts the `case_reference_build` row keyed by `(slug, version, variant)`. The
   version's API response and the public snapshot then carry the variant's
   `referenceBuild` URL, and the case page shows the **Reference** tab.

## From CI

The same command is wired as an on-demand GitHub Actions job,
`.github/workflows/publish-reference.yml` (`workflow_dispatch`), so a reference
can be (re)published without a local toolchain. Its inputs are `environment`
(`prod`/`staging`, for `--env`), `slug` (required), `version` (blank = newest), and
`variant` (blank = every variant that declares a reference). It reads
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `TCAB_BACKEND_URL`, and
`TCAB_TOKEN` from repository secrets, and a `publish-reference` concurrency group
serializes runs so two never race the same Pages project. Like the other deploy
workflows it is dormant until the repository is mirrored to GitHub.

## Reference implementation vs. reference mockup

Do not confuse a reference *implementation* with a `[[reference]]` **visual
mockup**. A mockup is a rendered screenshot of a single view that *is* seeded into
the run as a target the model builds toward; a reference implementation is the
whole playable game, is never seeded, and is deployed and shown as a live build.
The distinction is spelled out in
[Results → Reference implementations](/components/core/results/#reference-implementations).
