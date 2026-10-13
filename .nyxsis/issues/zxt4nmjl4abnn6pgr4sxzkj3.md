---
format: nyxsis-issue
version: 2
id: zxt4nmjl4abnn6pgr4sxzkj3
zone: REPOS
number: 18
title: Extract the public site into testcabinet.ai
type: generic
state: open
depends_on:
  - zwdbu3cf0k1byv4js6vtj29b
created: 2026-10-13T21:13:33.088360136Z
---

The public gallery lives in the superrepo as `apps/site`. The documentation
places it, with the `tcab.ai` share-link Worker and the preview-tag Worker,
in the `testcabinet.ai` repository, a site depending on `ui-common` and the
packages `contracts` generates:
`apps/docs/src/content/docs/components/site/overview.md`, section "Hosting",
`apps/docs/src/content/docs/development/releasing.md`, section "Gallery
(Cloudflare Pages and Workers, one-time)", and
`apps/docs/src/content/docs/development/repositories.md`, sections "The
repositories" and "The edges".

## What is missing

The `testcabinet.ai` repository on Azure, populated with the site's history,
rendered by the kit with its `typescript` gate and pipeline, deploying the
Pages project and the Workers as the releasing page states, and mirrored to
GitHub. The app is removed from the superrepo.

## Verify

`make gate` passes in the new repository and in the superrepo, and the
staging gallery deploys from the new repository's pipeline.
