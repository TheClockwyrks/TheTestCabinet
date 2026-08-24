---
title: Quickstarts
---

## Overview

Quickstarts are the short form of each task: the prerequisites, the commands, and
the check that it worked. The matching [user guide](/guides/overview/) covers the
same task in full. A machine that has never run The Test Cabinet starts with
[First Time Setup](/guides/setup/first-time-setup/).

## Setup

- [Set Up Authentication](/quickstarts/setup/set-up-authentication/) supplies the
  provider credentials a run's harness needs.
- [Register and Log In](/quickstarts/setup/register-and-login/) creates an
  account, so launching, reviewing, and publishing are attributed to you.

## Development

- [Run a Test Case](/quickstarts/development/run-a-test-case/) launches one case
  variant through a harness and watches it finish.
- [Run the Local Service Stack](/quickstarts/development/run-the-local-service-stack/)
  brings up the backend, auth, dispatcher, and artifact services on local k3d.
- [Review a Run](/quickstarts/development/review-a-run/) submits a review for a
  produced run.

## Authoring end-to-end and full-stack cases

- [End-to-end case](/quickstarts/authoring/author-an-end-to-end-test-case/)
  scaffolds a playable-game case or version under `test-cases/`.
- [End-to-end variant](/quickstarts/authoring/create-an-end-to-end-variant/)
  adds a playable mode to an existing end-to-end version.
- [Full-stack case](/quickstarts/authoring/author-a-full-stack-test-case/)
  scaffolds a case whose run produces the game and its own 2D assets.

## Authoring 2D asset-generation cases

- [Sprite case](/quickstarts/authoring/author-an-asset-generation-test-case/)
  scaffolds a sprite (`draw`) or sprite-sheet (`draw-sheet`) case or version.
- [Single-sprite variant](/quickstarts/authoring/create-a-sprite-variant/)
  adds a brief variation to a single-sprite version.
- [Sprite-sheet variant](/quickstarts/authoring/create-a-sprite-sheet-variant/)
  adds a brief variation to a sprite-sheet version.
- [UI case](/quickstarts/authoring/author-a-ui-test-case/) paints a
  high-resolution interface asset with the `paint` and `ui` binaries.
- [Material case](/quickstarts/authoring/author-a-material-test-case/)
  authors a tileable PBR material with `texture` and `pbr`.

## Authoring 3D asset-generation cases

- [Voxel model case](/quickstarts/authoring/author-a-voxel-model-test-case/)
  sculpts a static cube-voxel model with the `voxel` binary.
- [Voxel model variant](/quickstarts/authoring/create-a-voxel-model-variant/)
  adds a brief variation to a static voxel-model version.
- [Voxel animation case](/quickstarts/authoring/author-a-voxel-animation-test-case/)
  sculpts a rigged voxel model and authors its required animations.
- [Voxel animation variant](/quickstarts/authoring/create-a-voxel-animation-variant/)
  adds a brief variation to a rigged voxel version.
- [Mesh model case](/quickstarts/authoring/author-a-mesh-model-test-case/)
  sculpts a static meshed SDF model with `mc`, `sn`, or `dc`.
- [Mesh model variant](/quickstarts/authoring/create-a-mesh-model-variant/)
  adds a brief variation to a static meshed version.
- [Mesh animation case](/quickstarts/authoring/author-a-mesh-animation-test-case/)
  sculpts and rigs an animated meshed model with declared required animations.
- [Mesh animation variant](/quickstarts/authoring/create-a-mesh-animation-variant/)
  adds a brief variation to a rigged meshed version.
- [Skinned character case](/quickstarts/authoring/author-a-skinned-test-case/)
  sculpts one continuous deforming skin on a model-invented skeleton.
- [Blender character case](/quickstarts/authoring/author-a-blender-character-test-case/)
  builds a rigged, skinned character in headless Blender via `build.py` and
  `tcab-blend`.

## Authoring effects and audio cases

- [Particle case](/quickstarts/authoring/author-a-particle-test-case/)
  authors an emitter system simulated live against a brief.
- [Audio case](/quickstarts/authoring/author-an-audio-test-case/) authors a short
  clip through the matching audio binary.
- [Audio sample pack](/quickstarts/authoring/publish-an-audio-sample-pack/)
  builds a pack from its manifest, uploads it to R2, and pins it for the run
  image.

## DevOps

- [Add or Update a Model](/quickstarts/devops/add-or-update-a-model/) curates a
  model in the app.
- [Probe a Model](/quickstarts/devops/probe-a-model/) checks a model's
  responses-as-code readiness before spending gg runs on it.
- [Publish a Run](/quickstarts/devops/publish-a-run/) reviews a produced run and
  publishes it to the gallery.
- [Publish a Reference](/quickstarts/devops/publish-a-reference/) deploys a case
  variant's reference implementation and records it.
- [Publish Errata](/quickstarts/devops/publish-errata/) records a known issue
  with a shipped version without a version bump.
- [Roll Production Service Images](/quickstarts/devops/roll-prod-service-images/)
  promotes CI-built service images to the prod cluster.
- [Cut a Release](/quickstarts/devops/cut-a-release/) ships `vX.Y.Z`: prepare the
  release, rehearse it on staging, publish the artifacts, then land the catalog
  and the services in prod.
