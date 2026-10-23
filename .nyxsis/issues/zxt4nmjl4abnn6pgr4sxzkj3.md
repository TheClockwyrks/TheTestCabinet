---
format: nyxsis-issue
version: 3
id: zxt4nmjl4abnn6pgr4sxzkj3
zone: REPOS
number: 18
title: Extract the public site into testcabinet.ai
type: generic
state: done
depends_on:
  - zwdbu3cf0k1byv4js6vtj29b
created: 2026-10-13T21:13:33.088360136Z
done: 2026-10-22T11:48:53.720084056Z
outcome: |
  Extracted apps/site into the testcabinet.ai repository (pipeline 171, Pages
  deploys: master to the-test-cabinet, staging to the-test-cabinet-staging with
  wrangler, TCAB_SNAPSHOT_URL per branch), added it as a submodule and retired the
  superrepo's site-build and web-lint gates and steps (PR 5010, nightly
  581b3bb02). Staging is deployed from run 18206. The prod Pages deploy waits on
  PR 5008 (testcabinet.ai staging to master), which is the user's to approve;
  after it the gitlink moves from the staging commit to the master merge and the
  GitHub mirror's default branch becomes master. Runtime dataset reads are SITE-1
  and the two Workers are SITE-2. The superrepo jobs naming every submodule remain
  subject to CICD-1.
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
