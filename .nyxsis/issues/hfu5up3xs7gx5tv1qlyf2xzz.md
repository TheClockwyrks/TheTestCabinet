---
format: nyxsis-issue
version: 3
id: hfu5up3xs7gx5tv1qlyf2xzz
zone: DEPLOY
number: 3
title: Build asset-contract before the runtimes in the services image
type: generic
state: done
created: 2026-10-20T06:15:11.510057005Z
done: 2026-10-21T16:11:51.241405792Z
outcome: |
  Resolved by the driver extraction (REPOS-11, PR 4878): the driver's image is
  built from microservice-driver's Dockerfile, whose tcab-packages stage installs
  the @clockwyrks packages prebuilt from the feed with npm ci and stages them with
  scripts/stage-tcab-packages.mjs, so no package is compiled in the stage and no
  build order exists to get wrong. microservice-driver's master pipeline (run
  17663 on 8783b0bd) builds and pushes the image green. No superrepo change was
  needed; deployments/images/services.Dockerfile has no tcab-packages stage.
---

The driver's service image is built from `services.Dockerfile`, whose
`tcab-packages` stage builds the packages the run containers vendor:
`apps/docs/src/content/docs/deployment/kubernetes/overview.md`, section
"Pinning images", and `apps/docs/src/content/docs/development/building.md`.

## What is wrong

`scripts/stage-tcab-packages.mjs` builds `@clockwyrks/particle-runtime` and
`@clockwyrks/voxel-runtime` before `@clockwyrks/asset-contract`, which both
depend on, so `tsc` fails with TS2307 and `docker build --target driver`
fails at the `tcab-packages` stage on `nightly`.

## What to do

Order the stage's builds by the packages' dependency edges, so
`asset-contract` is built before the runtimes that import it, and cover the
order in `scripts/stage-tcab-packages.test.mjs`.

## Verify

`docker build -f services.Dockerfile --target driver .` succeeds, and
`scripts-test` and `build-context` pass.
