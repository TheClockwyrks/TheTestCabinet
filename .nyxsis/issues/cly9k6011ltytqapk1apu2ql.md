---
format: nyxsis-issue
version: 3
id: cly9k6011ltytqapk1apu2ql
zone: REPOS
number: 19
title: Create gg's public site as gg.rocks
type: generic
state: open
depends_on:
  - l60tznf9aueszxp7h65piw4b
created: 2026-10-13T21:13:52.537663143Z
---

gg has no public site. The documentation lists the `gg.rocks` repository, a
site rendered by the repository kit that depends on nothing of the project:
`apps/docs/src/content/docs/development/repositories.md`, sections "The
repositories" and "The edges", and
`apps/docs/src/content/docs/development/releasing.md`, section "Static-site
topology".

## What is missing

The `gg.rocks` repository on Azure, rendered by the kit as a site with its
`typescript` gate and a pipeline deploying its Pages project, mirrored to
GitHub, holding a site that presents gg from the `gg` repository's
documentation pages.

## Verify

`make gate` passes in the new repository, and the site deploys from its
pipeline.

## Blocked

The repository, its kit render, the `/docs` section, the Pages projects, the
pipeline, the branch protection and the GitHub mirror exist, and the superrepo
registers the submodule (PR 4450 into nightly, gitlink at gg.rocks nightly
8bdce01). gg.rocks staging holds 8bdce01 (PR 4447), and
`https://staging.gg.rocks/` and `/docs/overview/` answer 200. The promotion to
master is behind the branch policy of gg.rocks `master`, whose
Required-reviewers policy names the user, and the session's `az` identity is
the `nyxsis-workspaces` service principal, whose vote does not satisfy it.

What the user needs to do:

- Approve gg.rocks PR 4599 (staging -> master, auto-complete set). Its
  pipeline then deploys `gg-rocks`; check `https://gg.rocks/` and `/docs/`
  answer 200, and set the GitHub mirror's default branch to `master` (it is
  `main`, which does not exist).
- Until master holds 8bdce01, promote the superrepo no further than nightly:
  `submodule-pins` fails against gg.rocks master before then.

Alternatively, name the service principal in that policy so the drain can
finish the promotion itself.
