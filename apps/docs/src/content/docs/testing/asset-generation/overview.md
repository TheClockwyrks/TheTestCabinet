---
title: Overview
---

An asset-generation test case measures how well a model drives a tool toward a
goal described in a brief. The model produces a graphical, animated, or audio
asset rather than a program, one deliberate operation at a time. Assessment is
subjective: a case supplies a written brief and no target picture, so it rewards
creativity rather than reproduction of a supplied image. A published run carries
a human [review](/components/core/results/#reviews) of how convincingly the
asset realizes the brief.

## Run structure

The model works in an isolated environment containing an authoring binary on its
`PATH`. That binary is the channel a case provides for making a mark: it exposes
its editing operations as CLI subcommands, and the model builds the asset by
calling the binary repeatedly until it decides the asset is finished. The
binary's `--help` is the contract, and a case seeds no operations schema.

Two properties make this work as a benchmark.

- The model can see its progress. The binary writes a preview image the model
  reads to observe what it has produced so far. The 2D drawing binaries
  re-render after every operation. The 3D, particle, and audio binaries render
  on request, because meshing or re-rendering a whole asset costs far more than
  a 2D redraw.
- Every operation is recorded. The binary writes an ordered operation log to the
  path `[output].actions` names, and that log travels back to The Test Cabinet
  with the run. A Blender run records the `build.py` the model authored instead,
  because its authoring channel is a script rather than a series of calls.

Each `asset_kind` runs in its own container image, built from the shared base
image plus the binaries that kind authors with.

## Scored output

The `sprite` and `sprite-sheet` kinds are scored on the image regenerated from
the recorded operation log, never on the pixels the model left on disk. The
regeneration replays exactly the operations the model issued, so an image
produced by any other means contributes nothing to the result. Comparing the
regenerated image against the model's final on-disk image gives a second signal,
recorded as cheat divergence.

Every other kind is scored on the data its binary emits: the flattened
interface images, the material maps, the meshed geometry and rig, the particle
system definition, the rendered audio clip, or the native glTF a Blender run
exports. The validator parses that emitted data and confirms it is well-formed
and satisfies the case's contract. See
[Evaluation](/testing/asset-generation/evaluation/).

## Asset kinds

A case declares its `asset_kind`, which fixes the shape of the asset the model
produces. `asset_kind` is a property of the whole version. A case is exactly one
kind and a variant cannot change it. No kind carries a target image: every kind
is reviewed against the brief.

| `asset_kind` | What the model produces | Binaries |
| --- | --- | --- |
| `sprite` (default) | one small pixel image drawn onto the whole canvas | [`draw`](/testing/asset-generation/sprite-binaries/) |
| `sprite-sheet` | a set of animation frames, each its own file | [`draw-sheet`](/testing/asset-generation/sprite-binaries/) |
| `ui` | a high-resolution interface asset or kit of elements | [`paint`, `ui`](/testing/asset-generation/ui-binaries/) |
| `material` | a tileable PBR material | [`texture`, `pbr`](/testing/asset-generation/material-binaries/) |
| `voxel-model` / `voxel-animation` | a cube-voxel volume, static or rigged | [`voxel`, `voxel-anim`](/testing/asset-generation/voxel-binaries/) |
| `mc-model` / `mc-animation` | a low-poly meshed surface, static or rigged | [`mc`, `mc-anim`](/testing/asset-generation/mesh-binaries/) |
| `sn-model` / `sn-animation` | a smooth meshed surface, static or rigged | [`sn`, `sn-anim`](/testing/asset-generation/mesh-binaries/) |
| `dc-model` / `dc-animation` | a sharp-edged meshed surface, static or rigged | [`dc`, `dc-anim`](/testing/asset-generation/mesh-binaries/) |
| `mc-skinned` / `sn-skinned` / `dc-skinned` | a skinned character that deforms across its joints | [`mc-skin`, `sn-skin`, `dc-skin`](/testing/asset-generation/skinned-binaries/) |
| `blender-character` / `blender-prop` / `blender-mechanism` | a native glTF authored in headless Blender | [`tcab-blend`](/testing/asset-generation/blender-binaries/) |
| `particle-2d` / `particle-3d` | a live-simulated particle effect | [`particle-2d`, `particle-3d`](/testing/asset-generation/particle-binaries/) |
| `sfx-synth` / `sfx-sample` / `music` | a rendered PCM audio clip | [`sfx-synth`, `sfx-sample`, `music`](/testing/asset-generation/audio-binaries/) |

## 2D pixel assets

The `sprite` kind draws one image onto the whole canvas. The `sprite-sheet` kind
draws a set of animation frames, each a completely separate file of the canvas
size, targeted with `draw-sheet --frame <index>`.

A sprite-sheet case declares its frames and its animation sequences, each an
ordered list of frame indices with a playback rate. The review UI plays those
sequences back from the per-frame regenerated images, so a reviewer judges the
sheet by its motion as well as its static pixels.

## Interface assets

The `ui` kind produces the panels, HUD plates, buttons, frames, icons, and
backgrounds a game's interface is built from. It paints a 256–2048 px RGBA
canvas with a layer stack, alpha compositing and blend modes, brushes,
gradients, selections, masks, filters, and layer effects.

Two binaries author it. `paint` covers painterly raster work. `ui` covers the
structural parts: anti-aliased vector shapes, text in baked fonts, and
nine-slice insets that let a game scale one authored panel to any size while
keeping its corners undistorted.

A `ui` case is either one full-canvas image or a kit of named elements, each its
own document of its own size. Each element flattens to an RGBA PNG, and core
emits a `ui.json` carrying every element's size, its nine-slice insets, and its
atlas rectangle when packed, so a game binds the asset and addresses each piece
by name.

## PBR materials

The `material` kind produces a tileable material that dresses a 3D surface. A
material carries a required base-color map and any of normal, roughness,
metallic, ambient occlusion, and emissive. Each map is a square image painted so
that brushes, gradients, and filters wrap across the edges, letting it tile
without a seam.

Two binaries author it. `texture` restricts the `paint` vocabulary to one map at
a time, wraps every operation across the map edges, and adds procedural noise
and patterns. `pbr` bakes the normal and occlusion maps from a painted height
field, sets uniform scalar maps, assembles the `material.json`, and renders a lit
3D preview on a test surface.

A material is applied to a mesh by triplanar projection, sampling each map down
the world X/Y/Z axes and blending by the surface normal. That needs no UV
layout, which is the fit for signed-distance-field surfaces that have none.

## Voxel and meshed models

A 3D case builds into a fixed volume declared by its `[voxel]` table. The volume
starts empty and voxel material is opaque `#rrggbb`. There are two families.

The cube kinds, `voxel-model` and `voxel-animation`, paint discrete opaque
cells into the volume and read as blocky, Minecraft-style volumes.

The meshed kinds, `mc-*`, `sn-*`, and `dc-*`, composite a continuous
signed-distance field by adding and subtracting primitives such as spheres,
boxes, ellipsoids, and cylinders, optionally fusing them with a soft blend. The
binary then extracts the field's zero level set into a triangle mesh. The volume
frames the field rather than exposing individual cells. Each algorithm gives the
surface a fixed character, so a case picks the kind for the look it wants.

- Marching cubes (`mc-*`) samples a coarse grid and yields a chunky,
  faceted low-poly surface.
- Surface nets (`sn-*`) works on a medium grid and yields a watertight,
  mid-fidelity surface with uniform triangle density and rounded features.
- Dual contouring (`dc-*`) samples a fine grid and solves for feature
  positions, preserving sharp edges and corners.

Both families emit a per-part `.glb` as their geometry and preview through a
shared `wgpu` mesh renderer, an orbit-camera 3D view with lighting written on
request through the binary's `render` command. The frontend renders the emitted
geometry as an interactive 3D model with three.js: a static kind auto-rotates,
and an animated kind gives one orbit-drag viewer per animation.

## The rig

An animated kind produces a rig a consuming game poses at runtime. A rig is:

- Parts — named components in a parent/child hierarchy, each with an
  attachment pivot in its parent's local coordinates. Posing a parent moves its
  children. Each part is authored independently and targeted with
  `--part <name>`.
- Joints — named degrees of freedom on a part: a rotation about an axis
  through a pivot, or a translation along an axis, with a `min`/`max`/`rest`
  range. A caller joint is the procedural interface a game drives per frame
  from game state, such as `turret_yaw`, and is exported as machine-readable
  metadata. An auto joint is driven only by animations.
- Animations — named timelines with a `period`, a `loop` flag, and an
  `auto_play` flag. An `auto_play` animation is a continuous decorative idle the
  viewer and a game play by default; a non-`auto_play` animation is a named
  playable a game triggers. Each animation carries tracks, each driving one
  joint over an F-curve, so motion can carry weight and snap.

A case declares only the required animations. The model invents whatever rig
the subject needs, working out the parts, where they attach, and the joints they
require, and authors the keyframes and curves. It is judged on whether it worked
those pieces out and animated them convincingly. The produced `rig.json` carries
the whole rig the model built, and the review UI reconciles the produced
animations against the required set while the viewer poses the full rig.

Caller joints and animations are the two halves of the game-facing contract. A
game sets a caller joint each frame from its own state, and plays an animation
back as a clip.

## Skinned characters

The `mc-skinned`, `sn-skinned`, and `dc-skinned` kinds produce a character: a
single continuous skin that deforms across its joints, the way an elbow bends
without a seam. The model composites one whole-body signed-distance field, meshes
it once into a single surface, and binds that surface to a model-invented
skeleton whose bones carry the same joints and F-curve animations a rig does. The
binary derives per-vertex weights automatically, so the mesh follows the bones by
linear-blend skinning.

Skinned kinds reuse the meshed kinds' field authoring and the same three surface
characters. A case fixes only the required animations, leaving the skeleton and
its binding for the model to invent. A skinned model is inherently rigged, so
there is no static skinned kind. The first-person viewmodel an FPS wants, two
floating hands and a weapon on an attach socket, is authored the same way.

## Blender models

The `blender-character`, `blender-prop`, and `blender-mechanism` kinds are
authored by driving headless Blender through its `bpy` API. The model writes a
`build.py` and runs the `tcab-blend` runner, which exports a native glTF 2.0 and
a preview PNG. The emitted glTF is the judged output, and `build.py` is the
recorded authoring trace, re-run for provenance.

A `blender-character` is skinned and animated, carrying an armature and
per-vertex weights. A `blender-prop` is a static hard-surface model. A
`blender-mechanism` is rigidly articulated, its motion baked as glTF
node-hierarchy clips. All three form their own family rather than a variety of
the voxel, meshed, or skinned kinds.

## Particle effects

The `particle-2d` and `particle-3d` kinds produce a visual effect such as an
explosion, a muzzle flash, an engine plume, or a victory burst. The model authors
a system rather than placing individual particles: emitters describing what
spawns, where, how fast, and for how long; forces such as gravity, drag, a radial
explosion push, a vortex, and curl-noise turbulence; and per-particle F-curves
for size, color, and opacity over each particle's life.

The authored system definition is the asset. The review UI and a consuming game
each simulate it live from that definition, the way a real particle editor plays
a system. A stochastic effect therefore varies slightly from one play to the
next.

## Audio

The `sfx-synth`, `sfx-sample`, and `music` kinds produce a clip rendered to a PCM
`.wav`, capped by the case's `max_duration_ms`. The asset is a finished waveform
a game plays directly, so the audio kinds carry no runtime posing or simulation
library.

A model builds a clip through discrete operations exactly as it draws or
sculpts. `sfx-synth` layers a modular synth graph of oscillators, noise,
envelopes, filters, and FM. `sfx-sample` layers that same synthesis over the
sample library its case declares. `music` sequences notes on instrument tracks
and emits a portable `.mid` score beside the `.wav`. The binary renders a waveform and spectrogram,
and a piano-roll for music, that the model reads to see its progress.

## Further reading

[Manifests](/testing/asset-generation/manifests/overview/) is authoritative for
how a case declares its kind, its canvas or volume, its tool and output paths,
and its required animations. [Evaluation](/testing/asset-generation/evaluation/)
covers what the validator checks per kind and how a reviewer rates a run.
