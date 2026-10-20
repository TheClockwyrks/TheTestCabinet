---
format: nyxsis-issue
version: 3
id: oj5qwkcbhr22p0ta7ggc6iyf
zone: REPOS
number: 12
title: Extract the backend into microservice-backend
type: generic
state: open
depends_on:
  - txf8l556rdhfmbw9k1bxwvet
created: 2026-10-13T21:13:08.379701475Z
---

The backend crate, `entities`, `migration` and `db-auth` live in the
superrepo. The documentation places them in the `microservice-backend`
repository, an application depending on `contracts` and `engines`:
`apps/docs/src/content/docs/components/backend/overview.md` and
`apps/docs/src/content/docs/development/repositories.md`, sections "The
repositories", "The edges" and "Where each responsibility lives".

## What is missing

The `microservice-backend` repository on Azure, populated with the crates'
history and the ingest sidecar, rendered by the kit with its gates,
`build-context` and pipeline, pushing `tcab-backend:<commit>`, mirrored to
GitHub, and pinned by the superrepo's deploy sets as the "The record of what
builds together" section states. The crates are removed from the superrepo.

## Verify

`make gate` passes in the new repository and in the superrepo, a staging
deploy rolls the backend image at the submodule pointer, and the console on
staging lists runs and launches one.

## Blocked

The docs contradict each other on where the backend image reads gg's pin.
repositories.md says gg's version is "declared once in the driver". It also
says "A repository depends on another only along an edge". releasing.md and
control-plane.md say the backend image fetches gg-reference "at the version
the driver pins". Once the image is built by microservice-backend's own
pipeline, that read is an edge from microservice-backend to the driver (or
to gg). The edge tables list neither edge.

The user must decide one of these:

- A. microservice-backend keeps a mirrored `gg-release-version`, and the
  superrepo's dependency-graph gate holds it equal to the driver's pin
  (GG_PIN_MIRRORS). This is implemented on issue/repos-12, but it makes
  "declared once" untrue, so the docs would need to say so.
- B. Add a data edge microservice-backend -> microservice-driver (or -> gg)
  for the pin, and say how the backend's pipeline reads it.
- C. Move the pin into contracts, which both repositories already depend on.

Not the user's decision: test-suites PR 4766 and microservice-backend PR 4768
(auto-complete set) are waiting on the orchestrator's vote. After they merge,
the next pass moves both gitlinks to the merge commits and reruns
dependency-graph, k8s-deploy-sets, k8s-manifests and test-suites' gate.

The work so far is committed on the superrepo branch `issue/repos-12`
(pushed, no pull request): microservice-backend exists on Azure with its
master green, the superrepo branch registers it, removes the backend crates
and pins its image in the deploy sets, with option A implemented. The
circle-back merges nightly into that branch and finishes under the option
chosen.
