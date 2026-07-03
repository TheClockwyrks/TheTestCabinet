---
title: Evaluation
---

An asset-generation run's output is the image the model produced — but the image
**regenerated from the recorded actions**, never the pixels the model left on
disk. The output of a run is the ordered
[action log](/testing/asset-generation/manifests/) the drawing binary recorded,
and evaluation begins by turning that log back into an image. Assessment is then
**subjective**: there is no target image and no automated similarity score — the
regenerated asset is judged by a human against the case's brief.

## Regeneration

The harness replays the recorded operations through the **same drawing logic** the
binary used and takes the **regenerated image** as the run's output. Because the
regeneration runs exactly the operations the model issued — and nothing else — an
image produced by any other means contributes nothing to the result. This is what
makes the constrained drawing channel enforceable rather than merely requested
(see [Overview](/testing/asset-generation/overview/#why-the-actions-are-the-output)).

For a **sprite sheet** each frame is its own separate file, so each is regenerated
independently and carries its own cheat-divergence number; there is **no
whole-sheet aggregate**. The `[sheet]` table's named
[sequences](/testing/asset-generation/manifests/) are surfaced to the reviewer and
**played back as live animations** in the review UI (the regenerated frames in
each named sequence's order) so a person can judge the motion the sheet encodes
against the brief. A checklist item may also
[name the sequences and frames it is about](/testing/asset-generation/manifests/#review-items-can-reference-sequences-and-frames),
in which case the reviewer is shown exactly those animations and frames beside the
item — with a toggle between the live animation and the still frames — instead of
scanning the whole sheet to find them.

## Voxel regeneration

A [voxel](/testing/asset-generation/overview/#voxel-models-and-rigs) run
regenerates in the same way, one dimension up. The validator replays each part's
recorded operation log through the **same voxel-and-raster library** the
[voxel binary](/testing/asset-generation/voxel-binaries/) used and, per part,
produces two artifacts:

- **`voxels.json`** — the sparse, order-stable voxel data (only occupied cells,
  each an opaque `#rrggbb`, within the declared `[voxel]` volume). This is what the
  frontend renders as an interactive 3D model with three.js (see
  [voxel-runtime](/components/voxel-runtime/overview/)); it is a produced artifact,
  not part of the run record.
- **the regenerated isometric preview PNG** — rasterized by the same fixed,
  integer-only isometric projection the binary previews with. This is the **scored
  output** for the part.

A **static model** (`voxel-model`) has one part — the whole model — so it
regenerates one `voxels.json` and one preview. An **animated model**
(`voxel-animation`) regenerates **one per declared part**, independently, each with
its own cheat-divergence; there is no assembled-model aggregate. The
per-part previews are the scored artifacts.

### The rig

For an animated model the model authors **both** the mesh **and** the
**animations** — the timeline motions (a walk, a recoil, an idle) as
model-authored, first-class curves. The validator reconciles the model-produced
**`rig.json`** — the full rig it built: required parts, joints, **and animations**
plus any it added — against the case's **required**
[`[model]`](/testing/asset-generation/manifests/#voxel-cases) contract. A missing
required part, joint, **or animation** is a **zero-scored contract gap** that is
recorded (not a crash): the game-facing joint interface and the required motions a
case declares are scoring targets, so failing to produce them counts against the
run rather than aborting evaluation. The run record carries both the required
`model` and the produced `rig`, so the review UI can surface each caller joint (for
example `turret_yaw`) as a live control and the 3D viewer can pose the full rig
without a separate catalog lookup.

The reviewer scores the produced **motion** — how well each required animation
reads, such as a walk with a planted stance or the snap of a recoil — alongside the
mesh, and the review UI plays the produced animations back beside each caller
joint's live control.

## Cheat detection

Comparing the **regenerated image** against the **final image from the model's
run** is a second, independent signal. If a model drew only through the binary,
the two match. If they **diverge**, the model put pixels on the canvas outside the
recorded operations — for instance by writing an image file directly — which is a
strong sign it tried to bypass the drawing tool. The divergence is recorded so a
reviewer sees it; because only the regenerated image is ever scored, a model gains
nothing from drawing outside the tool, and the mismatch simply marks the attempt.

For a **voxel** run the identical check runs on the **isometric preview PNG**: the
one fixed rasterizer serves both the binary's in-container preview and the
validator's regeneration, so a model that placed voxels only through the tool
regenerates to the same PNG and a model that wrote a preview image directly
diverges. For an animated model each **part** carries its own cheat-divergence,
measured against that part's on-disk preview.

## Review

The human [review](/components/core/results/#reviews) is the assessment, not a
supplement to it: a published asset-generation run carries a writeup of how
convincingly the regenerated asset realizes the brief and how the model approached
the drawing, alongside the regenerated image and the recorded actions. The
cheat-detection signal informs that assessment — flagging a run that drew outside
the tool — but the judgment of the asset itself is the reviewer's.
