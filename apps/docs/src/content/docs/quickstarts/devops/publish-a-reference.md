---
title: Publish a Reference
---

Deploy a test-case variant's
[reference implementation](/components/core/results/#reference-implementations) —
the authored, *correct* static build, the answer key — to Cloudflare Pages and
record it so the case page's **Reference** tab can embed it. One command does it,
mirroring a run's publish. The full workflow, prerequisites, and the release-gate
policy are in
[Publishing a Reference Implementation](/guides/devops/publishing-a-reference-implementation/).

## Prerequisites

- You are [signed in](/quickstarts/setup/register-and-login/) (or a `TCAB_TOKEN`
  is set), and `TCAB_BACKEND_URL` points at the backend — recording the URL is
  authenticated.
- `wrangler` is on `PATH` with `CLOUDFLARE_API_TOKEN` (*Cloudflare Pages: Edit*)
  and `CLOUDFLARE_ACCOUNT_ID` set, and Node/npm are available for the case
  `[build]`.
- The target Pages project exists — `test-cabinet-references` (prod) or
  `test-cabinet-references-staging` (staging)
  ([one-time setup](/development/releasing/#reference-implementations-cloudflare-pages-one-time)).
- The case is **non-experimental** and its type supports a reference
  (end-to-end or full-stack). See the guide's
  [release gate](/guides/devops/publishing-a-reference-implementation/#which-cases-get-a-reference).

## Publish

```sh
tcab publish-reference --env prod <slug> [<version>] --dry-run   # show the plan, no credentials needed
tcab publish-reference --env prod <slug>                         # all variants, newest version
tcab publish-reference --env prod <slug> <version> --variant base   # exactly one variant
```

`--env` (`prod` or `staging`) is **required** — it selects the Cloudflare Pages
project and has no default, so a publish never silently targets prod.
`<version>` defaults to the newest version. With no selector, every variant that
declares a [`reference_implementation`](/testing/end-to-end/manifests/) is
published; `--variant X` targets one and errors if it has no reference. A
multi-variant sweep reports per-variant failures and exits non-zero if any failed,
but does not abort the rest.

## What it does

For each targeted variant: runs the case `[build]` install + build from the
reference-impl directory, scrubs secrets from the output, deploys it to the
`--env` Pages project under a `<slug>-<version>-<variant>` branch alias, reads the
served URL back from `wrangler`, and records it on the backend — where it surfaces
as the variant's `referenceBuild` and the case page's **Reference** tab.

## From CI

The same command runs as the `publish-reference.yml` GitHub Actions job
(`workflow_dispatch`, inputs `slug` / `version` / `variant`) once the repository
is mirrored to GitHub. See
[the guide](/guides/devops/publishing-a-reference-implementation/#from-ci).
