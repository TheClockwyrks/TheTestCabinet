---
format: nyxsis-issue
version: 3
id: cly9k6011ltytqapk1apu2ql
zone: REPOS
number: 19
title: Create gg's public site as gg.rocks
type: generic
state: done
depends_on:
  - l60tznf9aueszxp7h65piw4b
created: 2026-10-13T21:13:52.537663143Z
done: 2026-10-20T06:47:09.782031234Z
outcome: |
  The gg.rocks repository, its kit render, pipeline, branch protection, GitHub
  mirror and Pages projects exist; master holds 8bdce01 (PR 4599), run 17300
  deployed gg-rocks, https://gg.rocks/ and /docs/overview/ answer 200, and the
  mirror's default branch is master.
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
