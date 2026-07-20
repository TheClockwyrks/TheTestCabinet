---
title: Publish a Reference
---

Deploy a test-case variant's
[reference implementation](/components/core/results/#reference-implementations) —
the authored, *correct* static build, the answer key — to Cloudflare Pages, then get
it onto the case page's **Reference** tab via a **pull** flow: deploy, commit a
lockfile, re-ingest. The full workflow, prerequisites, and the release-gate policy
are in
[Publishing a Reference Implementation](/guides/devops/publishing-a-reference-implementation/).

## Prerequisites

- `wrangler` is on `PATH` with `CLOUDFLARE_API_TOKEN` (*Cloudflare Pages: Edit*)
  and `CLOUDFLARE_ACCOUNT_ID` set, and Node/npm are available for the case
  `[build]`. No backend URL, login, or token — the command never contacts the
  backend.
- The target Pages project exists — `test-cabinet-references` (prod) or
  `test-cabinet-references-staging` (staging)
  ([one-time setup](/development/releasing/#reference-implementations-cloudflare-pages-one-time)).
- The case is **non-experimental** and its type supports a reference
  (end-to-end or full-stack). See the guide's
  [release gate](/guides/devops/publishing-a-reference-implementation/#which-cases-get-a-reference).

## Publish

```sh
# 1. Deploy + write the lockfile (--env selects the Pages project AND the lock key).
tcab publish-reference --env prod <slug> [<version>] --dry-run   # show the plan first
tcab publish-reference --env prod <slug>                         # all variants, newest version
tcab publish-reference --env prod <slug> <version> --variant base   # exactly one variant

# 2. Commit + push the lockfile, then re-ingest so the backend reads it.
git add test-cases/reference-builds.lock.json && git commit -m "chore(references): record <slug>"
git push
scripts/reingest-cluster.sh --env prod
```

`--env` (`prod` or `staging`) is **required** — no default, so a publish never
silently targets prod. `<version>` defaults to the newest version. With no selector,
every variant that declares a
[`reference_implementation`](/testing/end-to-end/manifests/) is published;
`--variant X` targets one and errors if it has no reference. A multi-variant sweep
reports per-variant failures and exits non-zero if any failed, but does not abort the
rest.

## What it does

`tcab publish-reference` builds each variant's reference-impl, re-captures its
committed [baseline validation media](#baseline-validation-media), scrubs secrets,
deploys to the `--env` Pages project under a `<slug>-<version>-<variant>` branch
alias, reads the served URL back from `wrangler`, and writes it into
`test-cases/reference-builds.lock.json` under the `--env` key. It does **not** touch
the backend — the private backends [ingest that lockfile from their own git
checkout](/guides/devops/publishing-a-reference-implementation/#refresh-the-backend)
on the next `reingest-cluster.sh`, which is what lands each URL on the variant's
`referenceBuild` and the **Reference** tab.

## Baseline validation media

Regenerating a case's committed **baseline**
[validation](/testing/end-to-end/instrumentation/) media —
`validation-baseline/<variant>/`, the expected-behavior half of a reviewer's
side-by-side — is its own command, and needs **none** of the prerequisites above (no
`--env`, no Cloudflare credentials):

```sh
tcab capture-baselines <slug> [<version>] [--variant base] [--dry-run]
```

Run it whenever you add or change a debug script, or change the reference
implementation it drives, then commit the result. `publish-reference` re-captures the
same media as part of its build so a deploy stays in lockstep; pass
`--skip-baselines` to deploy without re-capturing when it is already current.

## From CI

`publish-reference.yml` (`workflow_dispatch`) builds, deploys, and commits the
lockfile. **Dispatch it on `master` to
publish prod, `staging` for staging** — the environment is derived from the branch.
You still run `reingest-cluster.sh` afterward. See
[the guide](/guides/devops/publishing-a-reference-implementation/#from-ci).
