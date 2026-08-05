---
title: Quickstarts
---

Quickstarts are short, task-focused refreshers for people who already know The
Test Cabinet and just need the steps. They stay deliberately terse: each one
gives the commands and the bare minimum of context, and links out to the
[User Guides](/guides/overview/) and [Components](/components/architecture/)
sections for the detail it skips.

If you are setting the project up for the first time, start with
[First Time Setup](/guides/setup/first-time-setup/) instead — the quickstarts assume a
working toolchain, a container runtime, the run-container image, and a configured
API key.

## Available quickstarts

### Setup

- [Set Up Authentication](/quickstarts/setup/set-up-authentication/) — give a harness
  the API key or subscription credentials a run needs.
- [Register and Log In](/quickstarts/setup/register-and-login/) — create a user account
  and sign in, so push, review, and publish are attributed to you.

### Development

- [Run a Test Case](/quickstarts/development/run-a-test-case/) — drive a single test case
  through a harness and write a run record.
- [Run the Local Service Stack](/quickstarts/development/run-the-local-service-stack/) — bring
  up the backend, dispatcher, driver, and console on local k3d and enqueue a run.
- [Review a Run](/quickstarts/development/review-a-run/) — submit a review (one per account)
  for a pushed run.

### Authoring — end-to-end

- [Author an End-to-End Test Case](/quickstarts/authoring/author-an-end-to-end-test-case/)
  — scaffold a new playable-game case or version under `test-cases/`.
- [Create an End-to-End Variant](/quickstarts/authoring/create-an-end-to-end-variant/) —
  add a new playable mode to an existing end-to-end version.

### Authoring — 2D asset generation

- [Author an Asset-Generation Test Case](/quickstarts/authoring/author-an-asset-generation-test-case/)
  — scaffold a new sprite (`draw`) or sprite-sheet (`draw-sheet`) case or version.
- [Create a Single-Sprite Variant](/quickstarts/authoring/create-a-sprite-variant/)
  — add a brief variation to a single-sprite version (`asset_kind = "sprite"`).
- [Create a Sprite-Sheet Variant](/quickstarts/authoring/create-a-sprite-sheet-variant/)
  — add a brief variation to a sprite-sheet version (`asset_kind = "sprite-sheet"`).
- [Author a UI Test Case](/quickstarts/authoring/author-a-ui-test-case/) — paint a
  high-resolution interface asset (`asset_kind = "ui"`) with the `paint`/`ui` binaries.
- [Author a Material Test Case](/quickstarts/authoring/author-a-material-test-case/) —
  author a tileable PBR material (`asset_kind = "material"`) with `texture`/`pbr`.

### Authoring — 3D asset generation

- [Author a Voxel Model Test Case](/quickstarts/authoring/author-a-voxel-model-test-case/)
  — sculpt a static cube-voxel model (`asset_kind = "voxel-model"`) with the `voxel` binary.
- [Create a Voxel Model Variant](/quickstarts/authoring/create-a-voxel-model-variant/) —
  add a brief variation to a static voxel-model version.
- [Author a Voxel Animation Test Case](/quickstarts/authoring/author-a-voxel-animation-test-case/)
  — sculpt a rigged voxel model and author its required animations (`asset_kind = "voxel-animation"`).
- [Create a Voxel Animation Variant](/quickstarts/authoring/create-a-voxel-animation-variant/)
  — add a brief variation to a rigged voxel version.
- [Author a Mesh Model Test Case](/quickstarts/authoring/author-a-mesh-model-test-case/) —
  sculpt a static meshed SDF model (`mc`/`sn`/`dc` — `*-model`) one operation at a time.
- [Create a Mesh Model Variant](/quickstarts/authoring/create-a-mesh-model-variant/) —
  add a brief variation to a static meshed version.
- [Author a Mesh Animation Test Case](/quickstarts/authoring/author-a-mesh-animation-test-case/)
  — sculpt and rig an animated meshed model (`*-animation`) with declared required animations.
- [Create a Mesh Animation Variant](/quickstarts/authoring/create-a-mesh-animation-variant/)
  — add a brief variation to a rigged meshed version.
- [Author a Skinned Character Test Case](/quickstarts/authoring/author-a-skinned-test-case/)
  — sculpt one continuous deforming skin on a model-invented skeleton (`mc`/`sn`/`dc-skinned`).
- [Author a Blender Character Test Case](/quickstarts/authoring/author-a-blender-character-test-case/)
  — build a rigged, skinned character in headless Blender via `build.py` + `tcab-blend`
  (`asset_kind = "blender-character"`).

### Authoring — effects & audio

- [Author a Particle Test Case](/quickstarts/authoring/author-a-particle-test-case/) —
  author an emitter system (`particle-2d`/`particle-3d`) simulated live against a brief.
- [Author an Audio Test Case](/quickstarts/authoring/author-an-audio-test-case/) — author
  a short clip (`sfx-synth`/`sfx-sample`/`music`) through the matching audio binary.
- [Publish an Audio Sample Pack](/quickstarts/authoring/publish-an-audio-sample-pack/) —
  build an `sfx-sample`/`music` pack from its manifest, upload it to R2, and pin
  it so the run image bakes it in.

### DevOps

- [Add or Update a Model](/quickstarts/devops/add-or-update-a-model/) — curate a model
  in the app (display name, aliases, logo, description).
- [Publish a Run](/quickstarts/devops/publish-a-run/) — push, review, and publish a run
  to public hosting and the gallery.
- [Publish a Reference](/quickstarts/devops/publish-a-reference/) — deploy a case
  variant's authored reference implementation to Cloudflare Pages and record it.
- [Publish Errata](/quickstarts/devops/publish-errata/) — record a known issue with a
  shipped version (no release, no version bump) so it stays in the version's metrics.
- [Roll Production Service Images](/quickstarts/devops/roll-prod-service-images/) —
  promote the latest CI-built service images to the prod cluster by re-pinning the
  overlay.
- [Cut a Release](/quickstarts/devops/cut-a-release/) — ship `vX.Y.Z`: prepare the
  release branch, rehearse on staging, publish the artifacts, then land the catalog
  and services in prod.

Each quickstart has a matching User Guide that covers the same task in full,
including prerequisites and the reasoning behind each step.
