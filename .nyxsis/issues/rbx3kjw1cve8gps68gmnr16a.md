---
format: nyxsis-issue
version: 3
id: rbx3kjw1cve8gps68gmnr16a
zone: DEPLOY
number: 5
title: Promote staging to master and deploy the edge to prod
type: generic
priority: 3
state: open
depends_on:
  - hvd0bgb29td3kqgkv1xv2u8m
created: 2026-10-23T06:31:00.091909791Z
---

Prod reaches its services through one origin, Cloudflare Access over a
Cloudflare Tunnel run by the `components/edge` component the `prod` overlay
includes: `apps/docs/src/content/docs/deployment/kubernetes/edge.md`.

## What is wrong

On 2026-10-23 prod ran the images of `origin/master` 0bf0d1413, which is from
before the edge. `tcab-prod` had no `tcab-cloudflared` Deployment and no
`tcab-artifacts`. It still ran `tcab-auth`, and the internal ingress was its
only working path. Nightly has been promoted to staging (PR 5154), but staging
has not been promoted to master, so the prod stage has not deployed the edge.

## What to do

Promote `staging` into `master` once staging's deploy of it is healthy, and let
the prod stage deploy the overlay. Then take the post-deploy steps from the
Edge page's "Setting up an environment" step 5 and from DEPLOY-4's outcome.
Before the promotion, run `scripts/ci/copy-artifact-trees.sh prod`. After the
deploy, run `kubectl rollout restart deploy/tcab-keyvault-sync -n tcab-prod`.

## Verify

`kubectl -n tcab-prod get deploy tcab-cloudflared` reports 2/2 ready. The tunnel
`tcab-prod` is healthy in Zero Trust.
`https://console.testcabinet.ai/api/healthz` answers 200 with the
`tcab-automation-prod` service token and 302 without it.
