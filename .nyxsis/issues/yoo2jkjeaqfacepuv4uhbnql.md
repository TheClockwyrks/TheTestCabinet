---
format: nyxsis-issue
version: 3
id: yoo2jkjeaqfacepuv4uhbnql
zone: SITE
number: 5
title: Retire the gallery deploy hook from the backend and the deploy
type: generic
priority: 3
state: open
created: 2026-10-23T16:20:27.522542876Z
---

The backend overview states under "Publish" that a publish is an upload, and
that no site rebuild and no deploy hook follow it; the gallery reads the index
objects at runtime:
`apps/docs/src/content/docs/components/backend/overview.md`. The releasing
page states that every Pages project is a Direct Upload project pushed with
`wrangler` by the owning pipeline:
`apps/docs/src/content/docs/development/releasing.md`, section "Gallery
(Cloudflare Pages and Workers, one-time)".

## What is wrong

The backend still fires a Cloudflare Pages deploy hook after every snapshot
upload (`TCAB_SITE_DEPLOY_HOOK_URL`, `crates/backend/src/snapshot.rs`
`upload_snapshot`, `crates/backend/src/publisher.rs`), and a hook that answers
anything but success fails the upload. The Pages projects `the-test-cabinet`
and `the-test-cabinet-staging` carry a hook named `Publish` connected to the
superrepo's GitHub mirror, whose branches no longer hold the gallery, so every
fire builds `npm run build:site` in a tree without that script and the
project reports a failed build.

## What to do

- Remove the deploy hook from the backend: the configuration value, the fire
  in `upload_snapshot`, the `deploy_hook_fired` outcome and the warning
  that R2 is configured without a hook. A snapshot upload ends when
  `index.json` is written.
- Remove `tcab-site-deploy-hook-url` from the keyvault-csi
  SecretProviderClass and `TCAB_SITE_DEPLOY_HOOK_URL` from the example
  secrets and the local overlay's notes.
- Leave the Pages projects' hooks and Git connection to the operator: they are
  deleted in the Cloudflare dashboard once the backend without the hook is
  deployed to the environment, staging first, then prod after the master
  promotion.

## Verify

`rust-test` and the backend's gates pass; `k8s-manifests` and
`k8s-deploy-sets` pass. On staging, after the deploy, a snapshot refresh
(`POST /snapshot/refresh`) uploads and the Pages project
`the-test-cabinet-staging` records no new build from a deploy hook.
