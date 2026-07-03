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
— today one of ten, split across two dimensionalities and, in 3D, two building
paradigms:

- **`sprite`** (the default) — a **single sprite**: one image drawn onto the whole
  canvas with the [`draw` binary](/testing/asset-generation/binaries/).
- **`sprite-sheet`** — a **sprite sheet**: a set of animation frames, each its own
  **completely separate file** (its own canvas, not a region of one larger image),
  drawn with the [`draw-sheet` binary](/testing/asset-generation/binaries/) and a
  required `--frame <index>`.
- **`voxel-model`** / **`voxel-animation`** — the **cube voxel** kinds: an
  opaque-RGB voxel volume of **discrete cells**, sculpted with the [`voxel` /
  `voxel-anim` binaries](/testing/asset-generation/voxel-binaries/). `voxel-model`
  is a static model; `voxel-animation` is a rigged, animated one — a hierarchy of
  named parts with named joints, each part sculpted with a required `--part <name>`.
- **`mc-model`** / **`mc-animation`**, **`sn-model`** / **`sn-animation`**,
  **`dc-model`** / **`dc-animation`** — the **meshed voxel** kinds: a smooth
  **surface extracted from a signed-distance field** built by compositing
  primitives, with the [`mc` / `sn` / `dc`
  binaries](/testing/asset-generation/voxel-binaries/) (and their `-anim` variants
  for the animated kinds). Each algorithm gives the surface a fixed character —
  Marching Cubes low-poly, Surface Nets smooth mid-fidelity, Dual Contouring
  high-fidelity with sharp edges (see [Meshed voxel
  models](#meshed-voxel-models)). The `-model` kinds are static; the `-animation`
  kinds are rigged and animated exactly like `voxel-animation`, each part built
  with a required `--part <name>`.

`asset_kind` is a property of the whole version, **not** a variant — a case is
exactly one kind, never a mix, and a variant cannot change it. None of the ten
carries a target: every kind is reviewed against the brief, never against a
supplied picture.

A **sprite-sheet** case adds a `[sheet]` table that declares its **frames** (each
by the index it is written to) and the **animation sequences** — ordered lists of
frame indices, each with a playback rate — so the review UI can play the named
animations back from the per-frame regenerated images and a reviewer can judge a
sheet by its motion, not just its static pixels.

## Voxel models and rigs

The **voxel** kinds move asset generation into 3D. The model builds into a fixed
**voxel volume** (declared by a `[voxel]` table: `width` × `height` × `depth`)
whose material is **opaque `#rrggbb`** — there is no alpha, and the volume starts
**empty**. The building binary records every operation and, after each one,
re-renders a **PNG preview** so the model can read a real image to see its progress
— exactly the role `canvas.png` plays for a sprite. Previews come from a shared
**`wgpu` mesh renderer** (an orbit-camera 3D view with lighting), so every voxel
kind previews through the same real-3D path.

There are two families of voxel kinds, differing in **how the model builds** and in
the geometry each emits:

- The **cube** kinds — `voxel-model` and `voxel-animation` — paint **discrete
  opaque cells** into the volume with the `voxel` / `voxel-anim` binaries.
- The **meshed** kinds — `mc-*`, `sn-*`, and `dc-*` — build a **continuous
  surface** from a signed-distance field, described in [Meshed voxel
  models](#meshed-voxel-models) below.

Both families emit a **mesh** as their geometry (a per-part `.glb`), and both
are judged the same way: the recorded **operation log** and the emitted geometry
(plus the rig, for an animated kind) are the authoritative output, and the
validator **parses the emitted data**, confirms it is well-formed and readable, and
checks that the [rig contract](#the-rig-parts-and-joints) is satisfied. There is no
image-similarity score and no cheat check — what is scored is the emitted data and a
reviewer's judgment of the rendered previews.

Because the emitted geometry travels in the result, the frontend renders it as an
**interactive 3D model** with three.js: a static (`-model`) view **auto-rotates**
the model, and an animated (`-animation`) view gives one **orbit-drag** viewer per
animation — mirroring how a sprite sheet's sequences animate in the review UI.

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
  `min`/`max`/`rest` range. A joint's **drive** is one of two kinds: a
  **`caller`** joint is the **procedural interface** a consuming game drives per
  frame from game state (the game-facing control, e.g. `turret_yaw`) and is
  exported as machine-readable metadata; an **`auto`** joint is driven only by
  animations and is not part of that procedural interface.
- **Animations** — the single, **model-authored** timeline concept. An animation
  has a `name`, a `period`, a `loop` flag (loop vs play-once-and-hold), and an
  `auto_play` flag — an `auto_play` animation is a continuous decorative idle
  (a radar spin) the viewer and a game play by default, while a non-`auto_play`
  animation is a named playable (walk, recoil) triggered on demand. Each
  animation carries one or more **tracks**, each driving one joint over an
  **F-curve** — a rich Bézier curve (the graph-editor curve real 3D tools use),
  not linear interpolation — so motion can carry weight and snap.

The manifest's `[model]` table declares **only** the **required animations** — the
game-facing contract and the scoring targets. It does **not** prescribe the parts or
joints: the model **invents whatever rig** the subject needs (working out the parts,
where they attach, and the joints they require), produces each part's mesh, and
**authors the animation keyframes and curves** — and is judged on whether it worked
those pieces out and animated them convincingly, not on following a prescribed
skeleton. Prescribing the full rig would turn the case into instruction-following
and make every model produce near-identical output; declaring only the animations
(what the thing is and how it must move) is what makes the case measure creativity.
The produced `rig.json` carries **everything** the model built (parts, joints, and
animations), and the review UI **reconciles** the produced animations against the
required set — a required animation that is missing, or that never actually
animates, is a contract gap — while the viewer poses the full rig.

#### Procedural drives vs baked animations

A game consumes the asset two ways, and the rig serves both. **Caller joints**
are procedural DOFs the game sets each frame from game state — a turret aimed at
a target — and are exported as an **interface** (node + axis + `min`/`max`/`rest`
limits) the game wires up. **Animations** are baked clips the game plays back —
walk, recoil, a spinning idle — with their easing captured in F-curves. The
turret is not a clip (the game rotates the `turret` joint itself, clamped to its
limits); the walk is not a caller joint (the game just plays it).

## Meshed voxel models

The **meshed** voxel kinds — `mc-model`/`mc-animation`, `sn-model`/`sn-animation`,
and `dc-model`/`dc-animation` — replace the cube kinds' discrete cells with a
**smooth surface**. Instead of painting voxels, the model composites a **continuous
signed-distance field** — a scalar field that, at every point in the `[voxel]`
volume, records the distance to the nearest surface — by **adding and subtracting
primitives** (spheres, boxes, ellipsoids, cylinders), optionally with a soft
`--blend` that fuses them smoothly. The binary then **extracts the surface** of that
field (its zero level set) into a triangle mesh. This is a CSG-style paradigm rather
than pixel- or cell-painting, which is why the meshing binaries are separate tools
with their own vocabulary; see [The voxel
binaries](/testing/asset-generation/voxel-binaries/).

The three algorithms extract the same field differently, and each gives the surface
a **fixed character** — you choose the kind (and so the binary) for the look you
want; it is not a per-case knob:

- **`mc-*` — Marching Cubes** samples the field on a **coarse** grid and emits a
  **low-poly**, chunky faceted surface.
- **`sn-*` — Surface Nets** works on a medium grid and emits a **smooth,
  mid-fidelity** surface: watertight, with uniform triangle density, rounded
  features, and no sharp edges.
- **`dc-*` — Dual Contouring** samples on a **fine** grid and solves for feature
  positions, giving a **high-fidelity** surface that **preserves sharp edges and
  corners** (and honors a per-primitive sharp-feature tag the other two cannot
  represent).

This differs from the **cube** kinds (`voxel-model`/`voxel-animation`), which place
discrete opaque cells and read as blocky, Minecraft-style volumes: the meshed kinds
never expose individual cells — the volume only **frames the field** the surface is
extracted from.

Everything else about the voxel family carries over unchanged. The meshed kinds emit
the same per-part `.glb` geometry and preview through the same `wgpu` renderer,
and — for the animated kinds (`mc-animation`, `sn-animation`, `dc-animation`) — are
**rigged and animated exactly as `voxel-animation` is**: the same parts, joints, and
model-authored F-curve animations described under [The rig](#the-rig-parts-and-joints)
above, one field authored per `--part` and composed and posed by the rig.

See [The voxel binaries](/testing/asset-generation/voxel-binaries/) for how the
model sculpts and rigs, the [voxel-runtime](/components/voxel-runtime/overview/)
package for how a game poses a produced rig, and
[Manifests](/testing/asset-generation/manifests/) for how a case declares its
canvas or `[voxel]` volume, `asset_kind`, the `[sheet]` frames and sequences, and
the `[model]` required animations.
