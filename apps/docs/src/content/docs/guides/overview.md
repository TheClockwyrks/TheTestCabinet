---
title: User Guides
---

User guides are the detailed, end-to-end walkthroughs of the tasks people
perform with The Test Cabinet. Where a [quickstart](/quickstarts/overview/) gives
just the steps for someone who already knows the tool, a user guide states the
prerequisites, the exact commands, and the reasoning behind the design choices
along the way.

If you only need a refresher, the matching quickstart is faster. Reach for the
guide when you are doing the task for the first time, or when you need to know
*why* a step is the way it is.

## Guides

### Setup

- [First Time Setup](/guides/setup/first-time-setup/) — install the toolchain,
  container runtime, run-container image, browser, and credentials, then make a
  first run.

### Development

- [Running the Local Service Stack](/guides/development/running-the-local-service-stack/) —
  stand up the backend, auth, dispatcher, driver, artifact service, and web
  console on local k3d, and drive runs the way a deployment does.
- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/) — play a
  finished run, read its validation signals, and write the required review.

### Authoring — end-to-end

- [Authoring an End-to-End Test Case](/guides/authoring/authoring-an-end-to-end-test-case/)
  — write a new playable-game case or version: its specification, prompt,
  references, and manifest.
- [Creating an End-to-End Variant](/guides/authoring/creating-an-end-to-end-variant/) — add
  a new playable mode to an existing end-to-end version.

### Authoring — 2D asset generation

- [Authoring an Asset-Generation Test Case](/guides/authoring/authoring-an-asset-generation-test-case/)
  — write a new sprite (`draw`) or sprite-sheet (`draw-sheet`) case or version: its
  brief, tool, output, and manifest.
- [Creating a Single-Sprite Variant](/guides/authoring/creating-a-sprite-variant/)
  — add a brief variation to a single-sprite version (`asset_kind = "sprite"`).
- [Creating a Sprite-Sheet Variant](/guides/authoring/creating-a-sprite-sheet-variant/)
  — add a brief variation to a sprite-sheet version (`asset_kind = "sprite-sheet"`).
- [Authoring a UI Test Case](/guides/authoring/authoring-a-ui-test-case/) — write a
  high-resolution interface asset (`asset_kind = "ui"`): one image or a kit of
  named elements, painted with the `paint` and `ui` binaries.
- [Authoring a Material Test Case](/guides/authoring/authoring-a-material-test-case/) —
  write a tileable PBR material (`asset_kind = "material"`): a set of maps painted
  with the `texture` and `pbr` binaries.

### Authoring — 3D asset generation

- [Authoring a Voxel Model Test Case](/guides/authoring/authoring-a-voxel-model-test-case/)
  — sculpt a static cube-voxel model (`asset_kind = "voxel-model"`) with the `voxel`
  binary.
- [Creating a Voxel Model Variant](/guides/authoring/creating-a-voxel-model-variant/) —
  add a brief variation to a static voxel-model version.
- [Authoring a Voxel Animation Test Case](/guides/authoring/authoring-a-voxel-animation-test-case/)
  — sculpt a rigged voxel model and author its required animations
  (`asset_kind = "voxel-animation"`).
- [Creating a Voxel Animation Variant](/guides/authoring/creating-a-voxel-animation-variant/)
  — add a brief variation to a rigged voxel version.
- [Authoring a Mesh Model Test Case](/guides/authoring/authoring-a-mesh-model-test-case/) —
  sculpt a static meshed signed-distance field (`asset_kind =
  "mc-model"`/`"sn-model"`/`"dc-model"`).
- [Creating a Mesh Model Variant](/guides/authoring/creating-a-mesh-model-variant/) — add
  a brief variation to a static meshed version.
- [Authoring a Mesh Animation Test Case](/guides/authoring/authoring-a-mesh-animation-test-case/)
  — sculpt and rig an animated meshed model (`asset_kind =
  "mc-animation"`/`"sn-animation"`/`"dc-animation"`) with declared required animations.
- [Creating a Mesh Animation Variant](/guides/authoring/creating-a-mesh-animation-variant/)
  — add a brief variation to a rigged meshed version.
- [Authoring a Skinned Character Test Case](/guides/authoring/authoring-a-skinned-test-case/)
  — write a single continuous deforming skin bound to a model-invented skeleton
  (`asset_kind = "mc-skinned"`/`"sn-skinned"`/`"dc-skinned"`).
- [Authoring a Blender Character Test Case](/guides/authoring/authoring-a-blender-character-test-case/)
  — build a rigged, skinned character in headless Blender via `build.py` + `tcab-blend`
  (`asset_kind = "blender-character"`).

### Authoring — effects & audio

- [Authoring a Particle Test Case](/guides/authoring/authoring-a-particle-test-case/) —
  write an emitter system simulated live (`asset_kind =
  "particle-2d"`/`"particle-3d"`).
- [Authoring an Audio Test Case](/guides/authoring/authoring-an-audio-test-case/) — write a
  short rendered clip (`asset_kind = "sfx-synth"`/`"sfx-sample"`/`"music"`).
- [Publishing an Audio Sample Pack](/guides/authoring/publishing-an-audio-sample-pack/) —
  build an `sfx-sample`/`music` pack from its manifest, publish it to the private
  R2 bucket, and pin it into the run-container image.

### DevOps

- [Adding or Updating a Model](/guides/devops/adding-or-updating-a-model/) — curate a
  model in the app (display name, aliases, provider logo, description), how
  derived models appear from runs, and how price history is recorded.
- [Publishing a Test Run Result](/guides/devops/publishing-a-test-run-result/) — release
  a reviewed run to public hosting and the gallery.
- [Publishing a Reference Implementation](/guides/devops/publishing-a-reference-implementation/) —
  deploy a case variant's authored, correct static build out-of-band, and the
  non-experimental release gate that governs when a reference is required.
- [Rolling Production Service Images](/guides/devops/rolling-prod-service-images/) —
  promote a CI-built service-image sha to the production cluster: re-pin the
  overlay, apply it through the private cluster, and commit.

These guides describe how to *use* The Test Cabinet. To understand how it works
internally, see the [Components](/components/architecture/) section.
