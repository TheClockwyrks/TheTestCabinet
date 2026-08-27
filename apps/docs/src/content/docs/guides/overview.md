---
title: User Guides
---

## Overview

User guides are the end-to-end walkthroughs of the tasks people perform with The
Test Cabinet. Each guide states the prerequisites, the exact commands, and the
constraints that govern the task. The matching
[quickstart](/quickstarts/overview/) is the same task reduced to its steps.

## Setup

- [First Time Setup](/guides/setup/first-time-setup/) installs the toolchain,
  stands up a reachable backend, registers an account, and makes a first run.

## Development

- [Running the Local Service Stack](/guides/development/running-the-local-service-stack/)
  stands up the backend, auth, dispatcher, driver, artifact, and arena services
  on local k3d, and drives runs the way a deployment does.
- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/)
  covers playing a finished run, reading its validation signals, and writing the
  required review.

## Authoring end-to-end and full-stack cases

- [Writing Case Specifications and Prompts](/guides/authoring/writing-case-specifications/)
  states the editorial rules every playable case's seeded specs and prompt
  follow.
- [Writing Debug APIs and Validators](/guides/authoring/writing-debug-apis-and-validators/)
  states the design rules for a playable case's debug API and its validator
  suite, on every engine.
- [Authoring a Case Showcase](/guides/authoring/authoring-a-case-showcase/)
  states what a variant's showcase media must show and how to capture real
  gameplay from its reference implementation.
- [Authoring an End-to-End Test Case](/guides/authoring/authoring-an-end-to-end-test-case/)
  covers writing a new playable-game case or version, with its specification,
  prompt, references, and manifest.
- [Creating an End-to-End Variant](/guides/authoring/creating-an-end-to-end-variant/)
  adds a new playable mode to an existing end-to-end version.
- [Authoring a Full-Stack Test Case](/guides/authoring/authoring-a-full-stack-test-case/)
  covers writing a case whose run produces both the game and its own 2D assets.

## Authoring 2D asset-generation cases

- [Authoring an Asset-Generation Test Case](/guides/authoring/authoring-an-asset-generation-test-case/)
  covers writing a new sprite (`draw`) or sprite-sheet (`draw-sheet`) case or
  version, with its brief, tool, output, and manifest.
- [Creating a Single-Sprite Variant](/guides/authoring/creating-a-sprite-variant/)
  adds a brief variation to a single-sprite version (`asset_kind = "sprite"`).
- [Creating a Sprite-Sheet Variant](/guides/authoring/creating-a-sprite-sheet-variant/)
  adds a brief variation to a sprite-sheet version
  (`asset_kind = "sprite-sheet"`).
- [Authoring a UI Test Case](/guides/authoring/authoring-a-ui-test-case/) covers
  a high-resolution interface asset (`asset_kind = "ui"`), either one image or a
  kit of named elements, painted with the `paint` and `ui` binaries.
- [Authoring a Material Test Case](/guides/authoring/authoring-a-material-test-case/)
  covers a tileable PBR material (`asset_kind = "material"`), a set of maps
  painted with the `texture` and `pbr` binaries.

## Authoring 3D asset-generation cases

- [Authoring a Voxel Model Test Case](/guides/authoring/authoring-a-voxel-model-test-case/)
  sculpts a static cube-voxel model (`asset_kind = "voxel-model"`) with the
  `voxel` binary.
- [Creating a Voxel Model Variant](/guides/authoring/creating-a-voxel-model-variant/)
  adds a brief variation to a static voxel-model version.
- [Authoring a Voxel Animation Test Case](/guides/authoring/authoring-a-voxel-animation-test-case/)
  sculpts a rigged voxel model and authors its required animations
  (`asset_kind = "voxel-animation"`).
- [Creating a Voxel Animation Variant](/guides/authoring/creating-a-voxel-animation-variant/)
  adds a brief variation to a rigged voxel version.
- [Authoring a Mesh Model Test Case](/guides/authoring/authoring-a-mesh-model-test-case/)
  sculpts a static meshed signed-distance field
  (`asset_kind = "mc-model"`/`"sn-model"`/`"dc-model"`).
- [Creating a Mesh Model Variant](/guides/authoring/creating-a-mesh-model-variant/)
  adds a brief variation to a static meshed version.
- [Authoring a Mesh Animation Test Case](/guides/authoring/authoring-a-mesh-animation-test-case/)
  sculpts and rigs an animated meshed model
  (`asset_kind = "mc-animation"`/`"sn-animation"`/`"dc-animation"`) with declared
  required animations.
- [Creating a Mesh Animation Variant](/guides/authoring/creating-a-mesh-animation-variant/)
  adds a brief variation to a rigged meshed version.
- [Authoring a Skinned Character Test Case](/guides/authoring/authoring-a-skinned-test-case/)
  covers a single continuous deforming skin bound to a model-invented skeleton
  (`asset_kind = "mc-skinned"`/`"sn-skinned"`/`"dc-skinned"`).
- [Authoring a Blender Character Test Case](/guides/authoring/authoring-a-blender-character-test-case/)
  builds a rigged, skinned character in headless Blender via `build.py` and
  `tcab-blend` (`asset_kind = "blender-character"`).

## Authoring effects and audio cases

- [Authoring a Particle Test Case](/guides/authoring/authoring-a-particle-test-case/)
  covers an emitter system simulated live
  (`asset_kind = "particle-2d"`/`"particle-3d"`).
- [Authoring an Audio Test Case](/guides/authoring/authoring-an-audio-test-case/)
  covers a short rendered clip
  (`asset_kind = "sfx-synth"`/`"sfx-sample"`/`"music"`).
- [Publishing an Audio Sample Pack](/guides/authoring/publishing-an-audio-sample-pack/)
  builds an `sfx-sample`/`music` pack from its manifest, publishes it to the
  private R2 bucket, and pins it into the run-container image.

## DevOps

- [Adding or Updating a Model](/guides/devops/adding-or-updating-a-model/)
  curates a model in the app, and covers how derived models and price history
  appear.
- [Authoring Errata](/guides/devops/authoring-errata/) records a known issue with
  a shipped test-case version without cutting a new version.
- [Publishing a Test Run Result](/guides/devops/publishing-a-test-run-result/)
  releases a reviewed run to public hosting and the gallery.
- [Publishing a Reference Implementation](/guides/devops/publishing-a-reference-implementation/)
  deploys a case variant's authored, correct static build out-of-band.
- [Rolling Production Service Images](/guides/devops/rolling-prod-service-images/)
  promotes a CI-built service-image sha to the production cluster.
- [Cutting a Release](/guides/devops/cutting-a-release/) walks the whole `vX.Y.Z`
  sequence: prepare the release on `nightly`, rehearse it on staging, publish
  the artifacts from GitHub, then land the catalog and the services in
  production.

## Component documentation

These guides describe how to use The Test Cabinet. The
[Components](/components/architecture/) section describes how it works
internally.
