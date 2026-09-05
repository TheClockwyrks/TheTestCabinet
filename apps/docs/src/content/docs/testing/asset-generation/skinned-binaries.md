---
title: Skinned binaries
description: The whole-body CSG/signed-distance-field authoring interface, bone-heat skin weighting, and skinned .glb (binary glTF) output contract for the Marching Cubes, Surface Nets, and Dual Contouring character-rig binaries (mc-skin/sn-skin/dc-skin).
---

A skinned asset-generation run sculpts an organic character: one continuous skin
that deforms across its joints, so an elbow bends without a seam. It is a close
sibling of the [mesh binaries](/testing/asset-generation/mesh-binaries/). The
same CSG-style signed-distance-field paradigm builds the surface and the same
rig model of parts, joints, and F-curve animations drives the motion. What
differs is how the rig moves the mesh: linear-blend skinning of a single mesh
bound to a skeleton with per-vertex weights, rather than one rigid transform per
part.

The rigid `-animation` kinds build separate meshes posed about pivots, which
gives wooden-puppet, mecha-style articulation with a seam at every joint. The
skinned kinds bind one continuous mesh to a skeleton and deform it by per-vertex
weights, so the skin around a rotating bone stretches and folds smoothly across
that seam. This is what a limbed creature, a humanoid, or a fabric-and-flesh
character needs.

There are three binaries, mirroring the three mesh algorithms and their fixed
surface character:

| Algorithm | binary | `asset_kind` | character |
| --- | --- | --- | --- |
| Marching Cubes | `mc-skin` | `mc-skinned` | low poly: coarse sample grid, chunky faceted surface; stylized characters |
| Surface Nets | `sn-skin` | `sn-skinned` | smooth mid-fidelity: watertight, uniform triangle density, rounded features; smooth organic creatures |
| Dual Contouring | `dc-skin` | `dc-skinned` | high fidelity: fine grid, preserves sharp edges and corners; armored, hard-surface characters |

The surface character is a fixed characteristic of the binary, exactly as for
the [static and animated mesh kinds](/testing/asset-generation/mesh-binaries/):
pick the algorithm for the look, and a case's `asset_kind` names it. A skinned
model is inherently rigged and animated. Every skinned case declares required
animations and every skinned model carries a skeleton. A character with no
deformation is a static `-model` kind instead.

The skinning binaries live in `crates/mc-skin`, `crates/sn-skin`, and
`crates/dc-skin`, on a shared `crates/model-skin` library holding the skeleton
binding, the bone-heat weighting, the linear-blend deform, and the skinned-`.glb`
encode. That library is built on `crates/voxel-mesh` for the SDF field type and
extraction, and `crates/model-core` for the rig and animation model, the CLI
record plumbing, color, config, and the generic `wgpu` renderer. Each binary is
baked into its own
[run-container image](/components/core/execution/#containerization), one per
`asset_kind`, so a run carries only the tool it uses. The binary emits a skinned
`mesh.glb` and the rig in `rig.json`, and the
[validator](/testing/asset-generation/evaluation/) parses those and confirms
they are well-formed. Nothing is regenerated after the run.

## The whole-body field

A skinning binary sculpts a single, whole-body signed-distance field, the entire
character at once, meshed into one continuous surface. There is no `--part`
flag: a skinned character is a single field with a single log, extracted once.

The CSG vocabulary is identical to `mc`, `sn`, and `dc`: the same additive and
subtractive primitives (`add-sphere`, `add-box`, `add-ellipsoid`,
`add-cylinder`, and their `subtract-*` counterparts), the same `--blend` soft
union, the same opaque `#rrggbb` `--color`, `replace-color`, the whole-field
`mirror`, `translate`, and `copy` edits, and `clear`. Additive primitives also
take the `--sharp` tag, which `dc-skin` honors and the other two ignore.
Coordinates match the rest of the family: `x` across, `y` up, `z` in depth,
forward at +z. The field starts empty, and the `background` a case declares is
the preview PNG's clear color alone. That vocabulary is documented under
[Field operations](/testing/asset-generation/mesh-binaries/#field-operations).

```
mc-skin add-ellipsoid --cx 8 --cy 22 --cz 8 --rx 3 --ry 5 --rz 3 --color "#d8b48a"
mc-skin add-cylinder --cx 8 --cy 14 --cz 8 --r 1.4 --height 8 --axis y \
                     --color "#d8b48a" --blend 1
mc-skin add-sphere --cx 8 --cy 30 --cz 8 --r 2.6 --color "#d8b48a" --blend 1
```

Everything the mesh binaries say about the field carries over. Primitive centers
and extents are real-valued and signed, the out-of-bounds portion is simply not
meshed, the recorded log rebuilds to the same field, and the extraction runs the
same fixed quadric-error-metric simplification before the mesh is encoded.

## Skeleton and skinning operations

On top of the field operations, a skinning binary carries a skeleton layer:
bones in a hierarchy, the joints that drive them, and the animations that play
the joints. The vocabulary is the binary's own `--help`, and a case seeds no
schema:

```
mc-skin --help                 # every operation, field and skeleton alike
mc-skin define-bone --help     # one operation's exact flags
```

The animation subcommands `define-animation` and `add-keyframe`, and the joint
semantics, are identical to the rig the voxel and mesh binaries author: the same
F-curve interpolation, the same period, loop, and auto-play metadata, the same
rotation-sign convention, and the same `caller` and `auto` drives. They are
documented under
[Rig subcommands](/testing/asset-generation/voxel-binaries/#rig-subcommands).
What differs is the skeleton and its binding to the skin:

```
mc-skin define-bone --name pelvis --parent ""
mc-skin define-bone --name spine  --parent pelvis
mc-skin define-bone --name upper_arm_l --parent spine
mc-skin set-bone --name upper_arm_l --head-x 5 --head-y 26 --head-z 8 \
                 --tail-x 3 --tail-y 20 --tail-z 8 --roll 0
mc-skin define-joint --name shoulder_l --bone upper_arm_l --kind rotation \
                     --axis x --min=-1.2 --max 1.6 --rest 0 --drive caller
mc-skin define-animation --name walk --period-ms 1000 --loop true --auto-play false
mc-skin add-keyframe --animation walk --joint shoulder_l \
                     --t-ms 0 --value 0.4 --interp bezier
```

`define-bone --name <n> --parent <p>` adds a bone under a declared parent, in a
parent-child hierarchy. The first bone defined is the root, with an empty
`--parent`. Posing a parent bone moves its children with it.

`set-bone` positions the bone's head, which is its default joint pivot, and its
tail, which sets the bone's direction and length, both in field coordinates.
`--roll` twists the bone about its own axis. A bone whose head and tail coincide
is a zero-length socket: it is excluded from the automatic weighting and
influences no vertex, while still exporting as a joint node. That is how an FPS
`weapon_socket` or a similar attach point is expressed.

`define-joint --name <n> --bone <b> --kind rotation|translation --axis x|y|z
--min --max --rest --drive caller|auto` adds a named degree of freedom on a
bone. The joint semantics are identical to the rig's: a `caller` joint is the
procedural interface a consuming game drives per frame, such as a head turn or
an aim, and an `auto` joint is driven only by the model's animations. The pivot
defaults to the bone head and is overridable with `--pivot-x/y/z`, and the
optional `--offset-x/y/z` and `--orient-x/y/z` fixed compound mount attaches at
a custom rotation and translation exactly as on a rig joint.

`paint-weight --bone <b> --box <x,y,z,w,h,d> --weight <0..1>` is an optional
override for a region the automatic weighting gets wrong, such as pinning a
helmet fully rigid to the head bone. It is recorded and applied after the
automatic weights.

## Automatic skin weights

Skin weights are derived at `render` rather than painted operation by operation.
Exactly as the mesh is a pure function of the recorded field, the per-vertex
weights are a pure function of the extracted mesh plus the recorded skeleton.

The binary computes them by bone-heat falloff weighting: each vertex is
influenced by the nearest deforming bones with a smooth inverse-square-distance
falloff over the surface, capped at a fixed maximum of four influences per
vertex and normalized so a vertex's weights sum to one. This is deterministic,
so replaying the recorded log reproduces identical weights. The maximum
influence count and the falloff are fixed characteristics of the binary. Where
the automatic result is wrong for a region, the optional
[`paint-weight`](#skeleton-and-skinning-operations) overrides are layered on top
of the derived weights.

## Recording and on-request rendering

Each operation, field or skeleton, appends itself to the run's operation log.
Extracting a surface and rasterizing it through the software renderer is far
more expensive than stamping 2D pixels, so rendering is a separate, on-request
step. The orchestrator seeds an `mc-skin.config.json`, and likewise for `sn-skin`
and `dc-skin`, next to the workspace giving the volume dimensions, background,
and the log, preview, mesh, `rig.json`, and posed-image paths, so neither an
operation nor `render` needs any flags.

```
mc-skin init                                  # empty log + an empty rig.json if absent
mc-skin render                                # extract, weight, write mesh.glb + preview
mc-skin render --view front                   # iso (default) | front | side | top
mc-skin render --time 500 --animation walk    # a posed, deformed preview
```

`render` with no options composites the whole-body field, extracts and
simplifies the surface, derives the skin weights, and writes the skinned
`mesh.glb` plus the whole-model preview PNG. A model runs it to see its progress
and, before finishing, to emit the geometry the run's result is built from. An
unrendered model leaves no mesh, which the validator records as empty.

`render --time <ms> [--animation <name>]` renders a posed preview with actual
skin deformation: the animation is sampled at that instant, the joints drive
their bones, and the mesh is linear-blend-skinned to the resulting bone
matrices, so the elbow visibly folds. The image is written to `scene/pose.png`,
overridable with `--out`, and the `mesh.glb` is left untouched. `--animation`
defaults to the sole animation or the auto-play one.

`init` writes an empty log and, when no `rig.json` is present, an empty skinned
rig. A run starts pre-seeded, so a model does not run `init` itself.

Recording and then rendering serves authoring ergonomics: the preview lets the
model, and a watching human, see the character it has built and how it deforms.
The [validator](/testing/asset-generation/evaluation/) regenerates nothing. It
decodes the emitted [`mesh.glb`](#the-glb-output-contract) and parses
`rig.json`, confirms they are well-formed and readable, and checks that each
required animation is present and actually animates.

### The preview

The preview is a 3D orbit view of the skinned mesh, 512 pixels square, produced
by the same generic mesh renderer the mesh binaries use, which lives in
`crates/model-core`. It renders with `wgpu` targeting Mesa lavapipe, a software
Vulkan implementation, so it runs CPU-only and headless with no GPU in the
container. A plain `render` draws the character at rest; a `--time` render draws
it deformed by linear-blend skinning at that instant.

The still preview is what a model reads and a reviewer sees. The interactive,
rotatable, posable 3D view is the frontend's rendering of the emitted `.glb`. See
[voxel-runtime](/components/voxel-runtime/overview/).

## Live preview

A watched run streams the model's sculpting to the viewer in real time,
mechanically identical to the
[mesh binaries](/testing/asset-generation/mesh-binaries/#live-preview). The
orchestrator adds a `live` block to the seeded config, carrying a
`host.docker.internal` endpoint and an opaque per-run token. When the model runs
`render`, the binary connects back to the run host and streams a one-line JSON
header (`{ token, frame, operation, operationCount, length, meshLength,
rigLength }`) followed by the rendered preview PNG's raw bytes, then
`meshLength` bytes of the current skinned `.glb`, then `rigLength` bytes of the
on-disk `rig.json`.

The mesh and rig bodies let the viewer rebuild and pose the character in 3D as
it is sculpted. A PNG-only viewer ignores them. Streaming is best-effort: it is
absent for an unwatched run, an operation succeeds whether or not the listener
responds, and the frames are never recorded. The recorded operation log and the
emitted `.glb` remain the run's authoritative output.

## The `.glb` output contract

A skinning binary emits a single skinned `mesh.glb`, a standard glTF 2.0 binary
container. Because a skinned character is one field and one mesh, this is one
file rather than a `{part}` template, and its `[tool].preview` and
`[output].actions` are single files too, even though a skinned kind is animated.
This is the skinned exception to the `{part}` rule that gives the rigid animated
kinds one file per part. The `mesh.glb` and `rig.json` are emitted by core's
seeded configuration rather than declared in the manifest.

The `mesh.glb` holds one mesh whose primitive carries, alongside the four
attributes the other kinds emit, the two extra vertex attributes and the glTF
structures that make it a skin:

- `POSITION`, an F32 `VEC3` per vertex.
- `NORMAL`, an F32 `VEC3` per vertex.
- `COLOR_0`, an F32 `VEC3` per vertex, carrying the same linear `0..1` RGB the
  runtime `PartMesh` uses.
- The index accessor, a U32 `SCALAR` triangle-vertex list.
- `JOINTS_0`, a U16 `VEC4` per vertex naming the up-to-four influencing bones.
- `WEIGHTS_0`, a normalized F32 `VEC4` per vertex carrying the matching weights.
- A glTF skin, with its inverse-bind-matrices accessor and its joint-node list.
- The bone node hierarchy, the skeleton as glTF nodes.

All the bulk binary data, the per-vertex weights and the inverse-bind matrices,
lives in the `.glb`.

Alongside it, `rig.json` carries the authored contract in the same shape the
runtime already consumes: the bones as the hierarchy, the joints with their
`caller` and `auto` drives and their ranges, the F-curve animations, any
`paint-weight` overrides, and a `skinned` marker telling a consumer this rig
deforms one mesh rather than posing rigid parts. It is metadata only.

### Runtime consumption

[`@clockwyrks/voxel-runtime`](/components/voxel-runtime/overview/) poses a
skinned rig by linear-blend skinning. Its pure core samples the animations and
caller values into bone matrices and skins the mesh through
`skinMesh(partMesh, weights, boneMatrices)`, and the `three` binding uses
`THREE.SkinnedMesh` and `Skeleton` for GPU skinning. Where a rigid-part kind
gives each part one rigid transform, here a single mesh's vertices each blend up
to four bone transforms. The glTF exporter passes the glTF skin through, so a
game gets a standard skinned, animated character it can play and drive through
its exported joint interface.

## First-person viewmodels

The same binaries produce first-person viewmodels, the two floating arms and
hands an FPS shows down the camera. A viewmodel is a skinned rig whose subject
is a partial body and whose required animations are FPS-flavored: draw,
idle-sway, walk-bob, fire, reload. It is authored with `mc-skin`, `sn-skin`, or
`dc-skin` like any other character, and its `[model]` required animations name
the FPS-flavored set. Two authoring conventions cover the first-person case:

1. View-space, in place. The arms are authored positioned and oriented as seen
   down the camera, lower in the frame and angled in, and every animation is
   authored in place, following the same rule as a
   [walk cycle](/testing/asset-generation/rigging-walkers/). Idle sway, walk
   bob, and recoil all cycle in place while the game mounts the rig to the
   camera.
2. The weapon is an attach socket. A held gun is a separate asset the game hangs
   on a `weapon_socket` bone, a zero-length bone with no vertex influence. Fire
   and reload move the hands and the socket, and the game attaches whatever
   weapon model it likes to the socket node. One pair of hands therefore holds
   different weapons.
