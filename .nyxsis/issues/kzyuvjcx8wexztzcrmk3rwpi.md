---
format: nyxsis-issue
version: 2
id: kzyuvjcx8wexztzcrmk3rwpi
zone: DATA
number: 2
title: Create the repos service as microservice-repos
type: generic
state: done
depends_on:
  - txf8l556rdhfmbw9k1bxwvet
created: 2026-10-13T21:12:43.921022081Z
done: 2026-10-19T13:38:20.97463697Z
---

A run's implementation is pushed to GitHub by the publisher Job from a tree it
reads itself, and nothing holds a run's repository between its end and its
publish. The documentation describes a repos service that receives each run's
implementation as a git bundle from the driver, stores it, serves it to the
backend and pushes it to the public repository when the run publishes:
`apps/docs/src/content/docs/components/repos/overview.md`.

## What is missing

- The `microservice-repos` repository on Azure, rendered by the repository
  kit as an application depending on `contracts`, mirrored to GitHub, with
  the `tcab-repos` binary holding the routes, storage, auth and deployment
  the page states.
- The driver committing the run's work and uploading the bundle at run end as
  the page's "The bundle" section states.
- The service deployed as the page's "Deployment" section and
  `apps/docs/src/content/docs/deployment/kubernetes/run-plane.md` state, with
  Azurite as its store on the local overlay and `local-forward` holding it on
  its port, as `apps/docs/src/content/docs/development/running.md` states.

## Verify

A run on the local stack ends with its bundle in the emulator's container,
`git clone` of the downloaded bundle recreates the repository with the seed
commit and the implementation, and `make gate` passes in the new repository
and in the driver's checkout.
