---
format: nyxsis-issue
version: 3
id: rbx3kjw1cve8gps68gmnr16a
zone: DEPLOY
number: 5
title: Promote staging to master and deploy the edge to prod
type: generic
priority: 3
state: done
depends_on:
  - hvd0bgb29td3kqgkv1xv2u8m
  - v7g831wei81xfao35yrhlk4q
created: 2026-10-23T06:31:00.091909791Z
done: 2026-10-23T19:38:54.93408502Z
outcome: |
  Staging was promoted into master through PR 5217 (merge 4fe28c570) after
  scripts/ci/copy-artifact-trees.sh prod copied the two run trees finished since
  the last pass (110 already in tcabprodstore/run-trees). Master run 18899
  (20261023.19) succeeded: Gates, Docs and Production. tcab-prod now runs
  tcab-cloudflared 2/2, tcab-artifacts 2/2 and tcab-repos 2/2 as Deployments, the
  backend at the-test-cabinet-backend:4fe28c570, and no tcab-auth or
  tcab-artifacts StatefulSet. After the deploy, kubectl rollout restart
  deploy/tcab-keyvault-sync -n tcab-prod created tcab-repos-secrets, and
  https://console.testcabinet.ai/api/healthz answers 302 without a credential
  (grafana.testcabinet.ai too). The prod Pages project's Publish deploy hook is
  deleted now that the prod backend fires none (SITE-5). Not verified from here:
  the 200 with the tcab-automation-prod service token, whose secret lives in the
  prod vault, and the tunnel's health in Zero Trust. EDGE-5 (retire the internal
  ingress and VPN path on prod) is now unblocked.
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
