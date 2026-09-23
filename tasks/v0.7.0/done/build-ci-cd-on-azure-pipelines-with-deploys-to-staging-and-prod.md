# Build CI/CD on Azure Pipelines with deploys to staging and prod

Turn `azure-pipelines.yml` from a gate-only pipeline into the one pipeline that
gates a commit, mirrors it to GitHub, builds its images into an Azure Container
Registry, and rolls it onto the staging or production cluster according to the
branch it landed on.

This issue depends on [`drop-the-desktop-app.md`](../drop-the-desktop-app.md) and
[`address-submodules-by-relative-url-and-mirror-them-to-github.md`](address-submodules-by-relative-url-and-mirror-them-to-github.md),
and runs after
[`rewrite-the-repository-history-without-baselines-and-wasm-blobs.md`](../rewrite-the-repository-history-without-baselines-and-wasm-blobs.md)
so the first mirror push carries the rewritten history.

## Current state

`azure-pipelines.yml` triggers on `master` and `staging` and runs CI only. Its
jobs are `rust`, `binary`, `web`, `webtest`, `desktop`, `specs`, `format`,
`validators`, `frozen`, `audiopacks`, `specvocabulary`, `buildcontext` and
`contract`, and each delegates to a script under `scripts/ci/`. Nothing in it
deploys.

Service images are built by `.github/workflows/build-service-images.yml` into
GHCR on every push to `master` and `staging`. Run-container images are built by
`build-containers.yml`, multi-arch and pinned by digest, and the dispatcher
resolves them through `TCAB_CONTAINER_REGISTRY` and `TCAB_CONTAINER_TAG`, which
default to `ghcr.io/theclockwyrks`. The `azure-staging` and `azure-prod` overlays
pin `ghcr.io` images by commit sha in their `images:` blocks, AKS pulls them
anonymously, and a roll is a hand-edited re-pin followed by `kubectl apply`.

Docs deploy to Cloudflare Pages through `deploy-docs.yml` with `wrangler`. The
clusters are `testcabinet-staging-westus2-aks` in
`testcabinet-staging-westus2-rg` and `testcabinet-prod-westus2-aks` in
`testcabinet-prod-westus2-rg`. The deployed backend runs an ingest sidecar that
refreshes its checkout and posts `/ingest` when the pod starts.

The reference for the shape is Nyxsis: `tmp/nyxsis/.azure-pipelines/ci.yml` with
`scripts/ci/mirror.sh`, `scripts/ci/deploy.sh` and `scripts/ci/image.sh`.

## Design

### Stages

The pipeline has three stages: `gates`, `images` and `deploy`. Every stage after
`gates` conditions on the gates having passed and on the branch, so a feature
branch runs the gates and nothing else.

### Gates

The gates are the existing jobs with `desktop` removed. Each check is one step,
named after the check, so Azure times and reports it on its own. The gg version
gate from `release.yml` moves here: on a tag build, `gg --version` must equal the
tag with its `v` stripped, and the build fails naming the crates to bump when it
does not.

### Mirror

A `mirror` job runs after the gates on `master`, `staging` and `nightly`. It
checks out with `fetchDepth: 0`, downloads the secure file `github-mirror-key`,
and runs `scripts/ci/mirror.sh`, which force-pushes the branch and its tags to
`github.com/TheClockwyrks/TheTestCabinet`. Because only this job pushes there,
the mirror holds gated commits and nothing else.

### Images

The `images` stage runs on `master` and `staging`. It builds every target of
`deployments/images/services.Dockerfile` and `web.Dockerfile`, and the
run-container images through `containers/build.sh`, each multi-arch, and pushes
them to a Test Cabinet Azure Container Registry tagged by the commit sha.

The push authenticates through a Docker Registry service connection under
workload identity federation, so no registry secret exists in the pipeline. The
AKS kubelet identity of each cluster holds `AcrPull` on the registry, so the
overlays need no pull secret.

### Deploy

The `deploy` stage uses a deployment job with `environment: tcab-staging` when
the branch is `refs/heads/staging` and `environment: tcab-prod` when it is
`refs/heads/master`. Neither environment has a manual approval check. The job
runs `AzureCLI@2` under a workload-identity service connection that may read the
cluster credentials and nothing else.

The deploy script mirrors Nyxsis's `deploy.sh`. It runs `az aks get-credentials`
for the environment's cluster, writes a throwaway kustomization beside
`deployments/k8s/overlays/azure-<env>` that sets every service image to its ACR
name at the build's sha and sets `TCAB_CONTAINER_TAG` to the same sha, applies
it, and waits on each workload's rollout. A rollout that fails to become ready is
described, its logs printed, and undone before the step fails.

The `azure-staging` and `azure-prod` overlays drop their hand-written `images:`
pins and image-tag patches, since the pipeline supplies them. The backend
rollout restarts its ingest sidecar, which refreshes the mirrored branch and
posts `/ingest`, so a deploy also publishes the catalog that shipped with it.

### Docs

A `docs` job on `master` and `staging` builds `apps/docs` and deploys it with
`wrangler` to `test-cabinet-docs` or `test-cabinet-docs-staging`. The Cloudflare
API token and account id are pipeline secrets.

### Pull requests

Azure Repos ignores a `pr:` block. Pull requests into `master` and `staging` run
the gates through build validation policies on those branches.

### Documentation

The following pages describe the new route: `deployment/overview.md`,
`deployment/kubernetes/overview.md`, the CI section of
`development/building.md`, `development/releasing.md`,
`quickstarts/devops/roll-prod-service-images.md` and `scripts/ci/README.md`.

## Done when

- [x] A push to a feature branch runs the gates and no other stage.
- [x] A push to `staging` passes the gates, mirrors to GitHub, pushes every
      service and run-container image to the ACR at the commit sha, and rolls
      the staging cluster to that sha with every rollout ready.
- [x] A push to `master` does the same against the production cluster.
- [x] A rollout that fails readiness is rolled back and fails the stage.
- [x] The overlays carry no image tags of their own.
- [x] The backend's ingest sidecar re-ingests after a roll and the deployed
      catalog matches the branch tip.
- [x] A tag build whose `gg --version` differs from the tag fails the gates.
- [x] The docs site deploys from the pipeline on `master` and `staging`.
- [x] Pull requests into `master` and `staging` run the gates through build
      validation policies.
- [x] The listed pages describe the pipeline as the deploy route.
- [x] Gates green.
