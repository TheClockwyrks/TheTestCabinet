---
format: nyxsis-issue
version: 3
id: ilzgslw4gum3exp3bj5w3mbg
zone: REPOS
number: 15
title: Extract the publisher into microservice-publisher
type: generic
state: done
depends_on:
  - txf8l556rdhfmbw9k1bxwvet
created: 2026-10-13T21:13:20.479525722Z
done: 2026-10-22T09:10:31.91398776Z
outcome: |
  Landed in PR 5009 into nightly (dd1eb3056): microservice-publisher exists on
  Azure with crates/publisher's history, kit render of the application kind naming
  contracts v0.2.4, a Dockerfile carrying the node base image, git, gh and
  wrangler 4.40.3 for the Pages deploy, pipeline 170 pushing
  microservice-publisher:<commit> for amd64 and arm64 (master c351e0a green),
  branch protection and GitHub mirror. The superrepo pins it as a submodule with
  branch ., the staging and prod deploy sets and pin-images.sh pin the publisher
  image at the submodule pointer (the dispatcher's TCAB_PUBLISHER_IMAGE), the
  publisher target leaves deployments/images/services.Dockerfile and
  service-images.sh so the backend is their only target, and crates/publisher is
  removed. Superrepo gates 24 of 24, the repository's 14 of 14, and a clean
  install resolves. Not verified: a publish on staging running the Job from the
  image at the submodule pointer, which follows the staging promotion (waiting on
  CICD-1); the amd64 image was built, not smoke-tested.
---

The publisher crate lives in the superrepo. The documentation places it in
the `microservice-publisher` repository, an application depending on
`contracts`, whose image the dispatcher runs as the per-publish Job:
`apps/docs/src/content/docs/components/backend/results.md`, section
"Publish", and `apps/docs/src/content/docs/development/repositories.md`,
sections "The repositories" and "The edges".

## What is missing

The `microservice-publisher` repository on Azure, populated with the crate's
history, rendered by the kit with its gates, `build-context` and pipeline,
pushing `tcab-publisher:<commit>`, mirrored to GitHub, and pinned by the
superrepo's deploy sets as the "The record of what builds together" section
states. The crate is removed from the superrepo.

## Verify

`make gate` passes in the new repository and in the superrepo, and a publish
on staging runs the Job from the image at the submodule pointer.
