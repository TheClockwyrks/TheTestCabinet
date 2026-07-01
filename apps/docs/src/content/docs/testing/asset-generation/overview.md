---
title: Overview
---

An **asset-generation** test case evaluates how well a model can use tools to
**produce a graphical asset** rather than to write a program. This spans **2D
work** — creating a sprite or a sprite sheet — and **3D work** — sculpting an
opaque-voxel model or a rigged, animated one — and it is a deliberately different
class of test from the others: it does not measure code generation at all, it
measures how well a model can drive a tool toward a goal **described in a brief**
through many small, deliberate steps. The result is **subjective** — the model is given a
precise written description and the freedom to draw something that matches it, so
the case rewards creativity rather than the faithful reproduction of a supplied
picture. There is **no target image** the model copies and no automated
similarity score; a published run carries a human [review](/components/core/results/#reviews)
of how convincingly the asset realizes the brief.

The [other test types](/testing/overview/) reward writing code that builds or
competes. Asset generation isolates a capability those cases deliberately design
*around* — [end-to-end](/testing/end-to-end/overview/) cases pre-provide assets so
that runs stay comparable and the test stays about software development. Here the
asset *is* the task.

## How it works

The model is given an **isolated environment** containing a **drawing binary** it
can call. The binary is the only way to make a mark: it exposes a set of editing
operations — brushes and other image mutations, as ordinary CLI subcommands — and
the model produces the asset by **calling the binary repeatedly**, one operation
at a time, until it decides the image is finished and returns. The binary's
`--help` is the contract (a case seeds no operations schema); see
[The drawing binaries](/testing/asset-generation/draw-tool/).

Two properties make this work as a benchmark:

- **The model can see its progress.** The binary renders the **actual image** at
  each step and writes it out, so the model can read a real image file to observe
  what it has drawn so far and decide what to do next. The binary does not need to
  keep *old* images — only the current one — so the model always sees the latest
  state without the environment accumulating history.
- **Every operation is recorded.** The binary records **all** the tool calls the
  model makes and returns that record to The Test Cabinet. The record — the
  ordered list of operations — is the real output of the run, not the pixels the
  model happened to have on disk when it stopped.

## Why the actions are the output

The image the model produced **cannot be trusted** as the result. A model could
sidestep the drawing tools entirely — writing code that emits an image file
directly — and a benchmark that scored those pixels would be measuring the wrong
thing. The Test Cabinet therefore treats the **recorded actions** as
authoritative and **regenerates** the image from them:

- The test harness replays the recorded operations through the **same drawing
  logic** the binary used and takes the **regenerated image** as the test output.
  Because the regeneration runs the same operations the model actually issued, an
  image produced by any means other than those operations simply does not exist in
  the result.
- Comparing the regenerated image against the **final image from the model's
  run** is itself a useful signal: if the two diverge, the model drew outside the
  recorded operations — a sign it tried to cheat by editing the image directly.
  See [Evaluation](/testing/asset-generation/evaluation/).

This regenerate-from-actions design is the asset-generation analogue of the
[adversarial sandbox](/testing/adversarial/overview/#the-controller-contract): in
both, the model is held to a constrained channel — a controller contract there, a
drawing tool here — and anything produced outside that channel is discarded rather
than scored.

## Asset kinds

A case declares, with its `asset_kind`, **what shape of asset** the model produces
— today one of four, split across two dimensionalities:

- **`sprite`** (the default) — a **single sprite**: one image drawn onto the whole
  canvas with the [`draw` binary](/testing/asset-generation/binaries/).
- **`sprite-sheet`** — a **sprite sheet**: a set of animation frames, each its own
  **completely separate file** (its own canvas, not a region of one larger image),
  drawn with the [`draw-sheet` binary](/testing/asset-generation/binaries/) and a
  required `--frame <index>`.
- **`voxel-model`** — a **static 3D voxel model**: an opaque-RGB voxel volume
  sculpted with the [`voxel` binary](/testing/asset-generation/voxel-binaries/).
- **`voxel-animation`** — a **rigged, animated 3D voxel model**: a hierarchy of
  named parts with named joints, each part sculpted with the
  [`voxel-anim` binary](/testing/asset-generation/voxel-binaries/) and a required
  `--part <name>`.

`asset_kind` is a property of the whole version, **not** a variant — a case is
exactly one kind, never a mix, and a variant cannot change it. None of the four
carries a target: every kind is [regenerated from its recorded
operations](#why-the-actions-are-the-output) and reviewed against the brief.

A **sprite-sheet** case adds a `[sheet]` table that declares its **frames** (each
by the index it is written to) and the **animation sequences** — ordered lists of
frame indices, each with a playback rate — so the review UI can play the named
animations back from the per-frame regenerated images and a reviewer can judge a
sheet by its motion, not just its static pixels.

## Voxel models and rigs

The two **voxel** kinds move the same regenerate-from-actions design into 3D. The
model sculpts into a fixed **voxel volume** (declared by a `[voxel]` table:
`width` × `height` × `depth`) whose cells are **opaque `#rrggbb`** — there is no
alpha, and the volume starts **empty**. The building binary records every
operation and, after each one, rasterizes a **deterministic, integer-only
isometric PNG preview** so the model can read a real image to see its progress —
exactly the role `canvas.png` plays for a sprite. That PNG is also what
[cheat-divergence](/testing/asset-generation/evaluation/) is measured against; the
authoritative output is still the recorded **operation log**, and the validator
regenerates both the voxel data (`voxels.json`) and the preview from it.

Because the stored voxel data is regenerated, the frontend can render it as an
**interactive 3D model** with three.js on top of the still preview: a
`voxel-model` view **auto-rotates** the model, and a `voxel-animation` view gives
one **orbit-drag** viewer per animation — mirroring how a sprite sheet's sequences
animate in the review UI.

### The rig: parts and joints

A `voxel-animation` is not just an animated mesh — it is a **rig** a consuming
game can pose at runtime (so a game can say "rotate the tank's turret to 37°").
A rig is:

- **Parts** — named voxel components in a **parent/child hierarchy** (a `turret`
  attached to a `chassis`), each with an **attachment pivot** in its parent's
  local voxel coordinates. Posing a parent moves its children with it. Each part
  is sculpted independently (its own operation log and preview) and targeted with
  `voxel-anim --part <name>`.
- **Joints** — named **degrees of freedom** on a part: a rotation (radians about
  an axis through a pivot) or a translation (voxel units along an axis), with a
  `min`/`max`/`rest` range. A joint is either **caller-driven** (a consuming game
  supplies the value at runtime — the game-facing control, e.g. `turret_yaw`) or
  **auto-play** (the model defines the motion as a looping keyframe clip the
  viewer and a game play back automatically).

The manifest's `[model]` table declares the **required** parts and joints — the
stable, game-facing joint interface and the scoring targets. At run time the model
may **add** further parts, joints, and auto-play clips of its own; the produced
`rig.json` carries **everything** (required plus model-added), and the review UI
scores against the required set while the viewer poses the full rig.

See [The voxel binaries](/testing/asset-generation/voxel-binaries/) for how the
model sculpts and rigs, the [voxel-runtime](/components/voxel-runtime/overview/)
package for how a game poses a produced rig, and
[Manifests](/testing/asset-generation/manifests/) for how a case declares its
canvas or `[voxel]` volume, `asset_kind`, the `[sheet]` frames and sequences, and
the `[model]` parts and joints.
