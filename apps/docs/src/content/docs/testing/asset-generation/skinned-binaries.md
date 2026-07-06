---
title: Skinned binaries
description: The whole-body CSG/signed-distance-field authoring interface, bone-heat skin weighting, and skinned .glb (binary glTF) output contract for the Marching Cubes, Surface Nets, and Dual Contouring character-rig binaries (mc-skin/sn-skin/dc-skin).
---

A **skinned** asset-generation run sculpts an organic **character** — one
continuous skin that **deforms across joints** (an elbow bends without a seam) —
through a **skinning binary** on its `PATH`. It is a close sibling of the
[mesh binaries](/testing/asset-generation/mesh-binaries/): the same CSG-style
[signed-distance-field](/testing/asset-generation/mesh-binaries/#the-field-is-a-continuous-signed-distance-field)
paradigm builds the surface, and the same
[rig model](/testing/asset-generation/overview/#the-rig-parts-and-joints) — parts,
joints, and F-curve animations — drives the motion. What is new is **how the rig
moves the mesh**: not one rigid transform per part, but **linear-blend skinning**
of a single mesh bound to a skeleton with per-vertex weights.

The contrast with the rigid kinds is the whole point of the family:

- The rigid, per-part [`-animation` kinds](/testing/asset-generation/mesh-binaries/#the-animated-binaries-one-field-per-part-plus-the-rig)
  (`mc-animation`, `sn-animation`, `dc-animation`) build **separate meshes posed
  about pivots** — wooden-puppet, mecha-style articulation. A turret swings on a
  ring; a leg is a rigid segment. There is a seam at every joint, and there has to
  be, because each part is its own mesh.
- The **skinned** kinds bind **one continuous mesh to a skeleton** and deform it by
  **per-vertex weights**: as a bone rotates, the skin around the joint stretches
  and folds smoothly across the seam that the rigid kinds cannot cross. This is what
  a limbed creature, a humanoid, or a fabric-and-flesh character needs.

There are three, mirroring the three mesh algorithms and their fixed surface
character:

| Algorithm | binary | `asset_kind` | character |
| --- | --- | --- | --- |
| **Marching Cubes** | `mc-skin` | `mc-skinned` | **low poly** — coarse sample grid, chunky faceted surface; stylized characters |
| **Surface Nets** | `sn-skin` | `sn-skinned` | **smooth mid-fidelity** — watertight, uniform triangle density, rounded features; smooth organic creatures |
| **Dual Contouring** | `dc-skin` | `dc-skinned` | **high fidelity** — fine grid, preserves sharp edges and corners; armored / hard-surface characters |

The surface character is a fixed characteristic of the binary, exactly as for the
[static and animated mesh kinds](/testing/asset-generation/mesh-binaries/#the-three-algorithms)
— you pick the algorithm for the look, and a case's `asset_kind` names it. A
**skinned model is inherently rigged and animated**: there is **no static skinned
kind**, because a character with no deformation is just a
[static model](/testing/asset-generation/mesh-binaries/) (a `-model` kind). Every
skinned case declares required animations and every skinned model carries a
skeleton.

The skinning binaries live in their own crates — `crates/mc-skin`, `crates/sn-skin`,
`crates/dc-skin` — on a shared new **`crates/model-skin`** library (the skeleton
binding, the bone-heat weighting, the linear-blend deform, and the skinned-`.glb`
encode), itself built on `crates/voxel-mesh` (the SDF field type and MC/SN/DC
extraction) and `crates/model-core` (the rig/animation model, the CLI
record/preview plumbing, color, config, and the generic `wgpu` renderer) — the same
libraries the [mesh](/testing/asset-generation/mesh-binaries/) and
[voxel](/testing/asset-generation/voxel-binaries/) binaries use. Each binary is
baked into its own [run-container image](/components/core/execution/#containerization)
— one image per `asset_kind` (`mc-skinned`, `sn-skinned`, `dc-skinned`) — so a run
carries only the tool it uses. Nothing is regenerated or re-rendered after the run:
the binary **emits** a skinned `mesh.glb` and the rig (`rig.json`), and the
[validator](/testing/asset-generation/evaluation/) parses those and confirms they
are well-formed.

## The field is one whole body

A skinning binary sculpts a **single, whole-body signed-distance field** — the
entire character at once, meshed into **one continuous surface**. There is **no
`--part` flag**: unlike the [animated mesh
binaries](/testing/asset-generation/mesh-binaries/#the-animated-binaries-one-field-per-part-plus-the-rig),
where each part is an independently-authored field with its own log, a skinned
character is a single field with a single log, extracted once.

The CSG/SDF vocabulary is **identical** to `mc`/`sn`/`dc` — the same additive and
subtractive primitives (`add-sphere` / `add-box` / `add-ellipsoid` / `add-cylinder`
and their `subtract-*` counterparts), the same `--blend` soft union, the same
opaque `#rrggbb` `--color` (there is **no alpha**), `replace-color`, the
whole-field `mirror` / `translate` / `copy` edits, and `clear`. Coordinates match
the rest of the family: `x` across, `y` **up**, `z` in depth, forward at +z. The
field starts **empty**, and the `background` a case declares is only the preview
PNG's clear color. Dual Contouring additionally carries the
[`--sharp` / `--smooth` tag](/testing/asset-generation/mesh-binaries/#dual-contouring-only-sharp-features),
as in `dc`. That whole vocabulary is documented under
[The field operations](/testing/asset-generation/mesh-binaries/#the-field-operations-are-ordinary-cli-subcommands)
and is not re-listed here; a short example:

```
mc-skin add-ellipsoid --x 8 --y 22 --z 8 --rx 3 --ry 5 --rz 3 --color "#d8b48a"  # torso
mc-skin add-cylinder --x 8 --y 14 --z 8 --r 1.4 --height 8 --axis y --color "#d8b48a" --blend 1  # upper arm
mc-skin add-sphere --x 8 --y 30 --z 8 --r 2.6 --color "#d8b48a" --blend 1        # head, fused
```

Everything the mesh binaries say about the field carries over: primitive centers and
extents are **real-valued** and **signed** (the out-of-bounds portion is simply not
meshed), the recorded log rebuilds to the **same field**, and the extraction runs
the same fixed [quadric-error-metric
simplification](/testing/asset-generation/mesh-binaries/#simplification-all-three)
before the mesh is encoded.

## The skeleton and skinning operations

On top of the field ops, a skinning binary carries a **skeleton layer**: bones in a
hierarchy, the joints that drive them, and the animations that play the joints. The
vocabulary is the binary's own `--help`, exactly as with every other tool (a case
seeds no schema):

```
mc-skin --help                 # every operation, field and skeleton alike
mc-skin define-bone --help     # one operation's exact flags
```

The **animation** subcommands — `define-animation` and `add-keyframe` — and the
**joint** semantics are **identical to the rig** the voxel and mesh binaries author:
the same F-curve interpolation (`constant` / `linear` / `bezier` plus the `ease-in`
/ `ease-out` / `ease-in-out` presets), the same period / loop / auto-play, the same
rotation-sign convention, and the same `caller`-vs-`auto` drives. They are
documented under [the voxel binaries' rig
subcommands](/testing/asset-generation/voxel-binaries/#rig-subcommands) and
[F-curves](/testing/asset-generation/voxel-binaries/#f-curves), and the design
guidance for legged rigs and walk cycles is in [Rigging and animating
walkers](/testing/asset-generation/rigging-walkers/) — none of it is re-documented
here. What differs is the **skeleton** and its **binding to the skin**:

```
mc-skin define-bone --name pelvis --parent ""                                  # root bone
mc-skin define-bone --name spine  --parent pelvis
mc-skin define-bone --name upper_arm_l --parent spine
mc-skin set-bone --name upper_arm_l --head-x 5 --head-y 26 --head-z 8 \
                 --tail-x 3 --tail-y 20 --tail-z 8 --roll 0
mc-skin define-joint --name shoulder_l --bone upper_arm_l --kind rotation --axis x \
                     --min=-1.2 --max 1.6 --rest 0 --drive caller
mc-skin define-animation --name walk --period-ms 1000 --loop true --auto-play false
mc-skin add-keyframe --animation walk --joint shoulder_l --t-ms 0   --value 0.4  --interp bezier
mc-skin add-keyframe --animation walk --joint shoulder_l --t-ms 500 --value=-0.4 --interp ease-in
```

- **`define-bone --name <n> --parent <p>`** adds a bone under a declared parent, in
  a parent/child hierarchy. The **first bone defined is the root** (no parent, an
  empty `--parent`); posing a parent bone moves its children with it. A bone is a
  **head→tail segment**.
- **`set-bone --name <n> --head-x/--head-y/--head-z --tail-x/--tail-y/--tail-z
  [--roll <rad>]`** positions the bone's **head** — its default joint pivot — and
  its **tail**, which sets the bone's direction and length, in field coordinates.
  `--roll` twists the bone about its own axis.
- **`define-joint --name <n> --bone <b> --kind rotation|translation --axis x|y|z
  --min --max --rest --drive caller|auto [--pivot-x/y/z] [--offset-x/y/z
  --orient-x/y/z]`** adds a named **degree of freedom** on a bone. The joint
  semantics are **identical** to the rig's: a **`caller`** joint is the **procedural
  interface** a consuming game drives per frame (a head turn, an aim), exported as
  machine-readable metadata; an **`auto`** joint is driven only by the model's
  animations. `--min`/`--max`/`--rest` give its range; the optional
  `--offset`/`--orient` **fixed compound mount** attaches at a custom rotation and
  translation exactly as [on a rig
  joint](/testing/asset-generation/voxel-binaries/#rig-subcommands). The **pivot
  defaults to the bone head**.
- **`paint-weight --bone <b> --box <x,y,z,w,h,d> --weight <0..1>`** is an
  **optional** override for a region the automatic weighting gets wrong — for
  example pinning a helmet **fully rigid** to the head bone so it does not stretch.
  It is recorded and **applied after the automatic weights**. Manual weight
  **painting is otherwise unnecessary**: weights are derived automatically (below).
- **`define-animation`** / **`add-keyframe`** author the animations, **identical to
  the rig's F-curve model**. Joints rotate bones; the skin follows via linear-blend
  skinning.

## Automatic skin weights are the conversion step

Skin weights are **not painted operation-by-operation**. They are **derived at
`render`**, as the skinned family's analogue of the meshing step: exactly as the
mesh is a pure function of the recorded field, the **per-vertex weights are a pure
function of the recorded field's extracted mesh plus the recorded skeleton**.

The binary computes them by **bone-heat diffusion weighting**: each vertex is
influenced by the **nearest bones** with a smooth heat falloff over the surface,
capped at a **fixed maximum of four influences per vertex** and **normalized** so a
vertex's weights sum to one. This is **deterministic** and **derived** — replaying
the recorded log reproduces identical weights, just as it reproduces the mesh
itself. The **max-influences (4) and the falloff are fixed characteristics of the
binary**, not per-operation knobs. Where the automatic result is wrong for a region,
the optional [`paint-weight`](#the-skeleton-and-skinning-operations) overrides are
layered on top of the derived weights.

## How a call records; rendering is on request

Each operation — field or skeleton — **only appends itself to the run's operation
log**. As with the [mesh](/testing/asset-generation/mesh-binaries/#how-a-call-records-rendering-is-on-request)
and [voxel](/testing/asset-generation/voxel-binaries/#how-a-call-records-rendering-is-on-request)
binaries, extracting a surface and rasterizing it through the `wgpu`+Mesa renderer
is far more expensive than stamping 2D pixels, so the tool does **not** re-render
after every call. Rendering is a separate, **on-request** step. The orchestrator
seeds an `mc-skin.config.json` (and likewise for `sn-skin` / `dc-skin`) next to the
workspace giving the volume dimensions, background, and the log / preview / mesh
(`.glb`) / `rig.json` paths, so neither an operation nor `render` needs any flags.

The **`render` command** rebuilds the derived artifacts from the recorded log:

```
mc-skin init                                  # write an empty log + a pre-seeded rig.json; renders nothing
mc-skin render                                # extract the surface, derive skin weights, write mesh.glb + preview PNG
mc-skin render --view front                   # ...from a chosen camera: iso (default) | front | side | top
mc-skin render --time 500 --animation walk    # ...posed with actual skin deformation, to scene/pose.png
```

- **`render`** (no options) composites the whole-body field, extracts and simplifies
  the surface, **derives the skin weights**, and writes the skinned **`mesh.glb`**
  plus the whole-model preview PNG. A model runs it to see its progress and,
  **before it finishes, to emit the geometry the run's result is built from** — an
  unrendered model leaves no mesh, which the validator records as empty.
- **`render --time <ms> --animation <name>`** renders a **posed** preview with
  **actual skin deformation**: the animation is sampled at that instant, the joints
  drive their bones, and the mesh is **linear-blend-skinned** to the resulting bone
  matrices — so you see the elbow actually fold — written to `scene/pose.png`.
- **`render --view iso|front|side|top`** chooses the camera.
- **`init`** seeds an **empty log** and a `rig.json` pre-populated with the case's
  **required animation declarations** alone (its **parts/joints start empty**,
  because a case declares none). A field or skeleton operation records; a run starts
  pre-seeded, so a model does not run `init` itself.

Recording-then-rendering exists for **authoring ergonomics only** — the preview lets
the model (and a watching human) see the character it has built and how it deforms.
It is **not** a cheat-detection mechanism. The
[validator](/testing/asset-generation/evaluation/) does not regenerate or re-render
anything: it decodes the emitted [`mesh.glb`](#the-glb-output-contract) and parses
`rig.json`, confirms they are well-formed and readable, and checks the **rig
contract** (that each required animation is present and actually animates).

### The preview (wgpu + Mesa lavapipe)

The preview `render` draws is a real **3D orbit view** of the skinned mesh, produced
by the same generic mesh renderer the [mesh
binaries](/testing/asset-generation/mesh-binaries/#preview-rendering-wgpu--mesa-lavapipe)
use — geometry, an orbit camera, and directional lighting into a PNG — which lives
in the shared `crates/model-core` library. It renders with **`wgpu`** targeting
**Mesa lavapipe** (a **software Vulkan** implementation), so it runs **CPU-only and
headless**, with **no GPU in the container**. The same renderer serves every
voxel-family binary, so previews are **apples-to-apples** across all algorithms and
kinds. A plain `render` draws the character at rest; a `--time` posed render draws it
**deformed** by linear-blend skinning at that instant. Because nothing is
regenerated for scoring, the renderer carries no determinism requirement. The still
preview is what a model reads and a reviewer sees; the interactive, rotatable,
posable 3D view is the frontend's rendering of the emitted `.glb` — see
[the `.glb` contract](#the-glb-output-contract) and
[voxel-runtime](/components/voxel-runtime/overview/).

## Live preview

When a run is being **watched** — driven by a [driver](/components/driver/overview/)
or the [Tauri app](/components/tauri/overview/) rather than a plain `tcab run` — the
model's sculpting is streamed to the viewer in real time, mechanically identical to
the [mesh](/testing/asset-generation/mesh-binaries/#live-preview),
[voxel](/testing/asset-generation/voxel-binaries/#live-preview), and
[drawing](/testing/asset-generation/binaries/#live-preview) tools: the orchestrator
adds a `live` block (a `host.docker.internal` endpoint and an opaque per-run token)
to the seeded config, and **when the model runs `render`** the binary connects back
to the run host and streams a one-line JSON header
(`{ token, frame, operationCount, operation, length, meshLength }`) followed by the
freshly rendered preview PNG's raw bytes and then the model's current skinned
`.glb` bytes (`meshLength` bytes). The mesh body lets the viewer rebuild and pose
the character **in 3D** as it is sculpted, rather than showing only the flat preview
PNG; a PNG-only viewer simply ignores it. Streaming is **best-effort and
non-essential** — absent for an unwatched run, never fails an operation, and never
recorded; the recorded **operation log** and the emitted `.glb` remain the run's
authoritative output.

## The `.glb` output contract

A skinning binary emits a **single skinned `mesh.glb`** — a standard **glTF 2.0
binary** container. Because a skinned character is **one field / one mesh**, this is
**one file, not a `{part}` template**, and its
[`[tool].preview`](/testing/asset-generation/manifests/) and `[output].actions` are
**single files** too — **even though a skinned kind is animated**. This is the
**skinned exception** to the [animated-kind `{part}`
rule](/testing/asset-generation/mesh-binaries/#the-glb-output-contract) that gives
`mc-animation`/`sn-animation`/`dc-animation` one file per part. The `mesh.glb` and
`rig.json` are **core-emitted automatically** — not manifest-declared.

The `mesh.glb` holds one mesh whose primitive carries, alongside the four attributes
the other kinds emit, the two extra vertex attributes and the glTF structures that
make it a **skin**:

- **`POSITION`** — F32 `VEC3` per vertex,
- **`NORMAL`** — F32 `VEC3` per vertex,
- **`COLOR_0`** — F32 `VEC3`, using the same normalization the runtime `PartMesh`
  uses,
- **indices** — a U32 `SCALAR` triangle-vertex list,
- **`JOINTS_0`** — a bone-index `VEC4` per vertex (the up-to-four influencing
  bones),
- **`WEIGHTS_0`** — a normalized F32 `VEC4` per vertex (the matching skin weights),
- a glTF **skin** — its **inverse-bind-matrices** accessor and its joint-node list,
  and
- the **bone node hierarchy** — the skeleton as glTF nodes.

All the **bulk binary** (the per-vertex weights and the inverse-bind matrices) lives
in the `.glb`, per the [data-format
principle](/testing/asset-generation/mesh-binaries/#the-glb-output-contract): bulk
numeric data is binary, never JSON.

Alongside it, **`rig.json`** carries the **authored contract** — the **same
`ModelSpec` / `JointSpec` shape the runtime already consumes**: the **bones** (as
the hierarchy), the **joints** (the `caller`/`auto` DOFs and their ranges — the
procedural interface a game drives), the **F-curve animations**, and a **`skinned`
marker** that tells a consumer this rig deforms one mesh rather than posing rigid
parts. It is **metadata only**; the bulk skin binding lives in the `.glb`.

### Runtime consumption

[`@test-cabinet/voxel-runtime`](/components/voxel-runtime/overview/) poses a skinned
rig by **linear-blend skinning**: its pure-core samples the animations and caller
values into **bone matrices** and skins the mesh
(`skinMesh(partMesh, weights, boneMatrices)`), and the `three` binding uses
`THREE.SkinnedMesh` + `Skeleton` for GPU skinning. Contrast the
[rigid-part kinds](/testing/asset-generation/mesh-binaries/#the-glb-output-contract),
where each part gets **one rigid transform**; here a single mesh's vertices each
blend up to four bone transforms. The glTF exporter **passes the glTF skin
through**, so a game gets a standard skinned, animated character it can play and
drive through its exported joint interface.

## First-person viewmodels

The same binary produces **first-person viewmodels** — the two floating arms and
hands an FPS shows down the camera. A viewmodel is just a skinned rig whose
**subject is a partial body** and whose **required animations are FPS-flavored**
(draw, idle-sway, walk-bob, fire, reload). It needs **no separate tool** — there is
**no dedicated first-person binary**, because a viewmodel is exactly a skinned
character built with two authoring conventions:

1. **View-space, in place.** The arms are authored **positioned and oriented as seen
   down the camera** — lower in the frame, angled in — and **every animation is
   authored in place**, following the same [author in place; the game supplies the
   travel](/testing/asset-generation/rigging-walkers/) rule as a walk cycle. Idle
   sway, walk bob, and recoil all **cycle in place** while the game mounts the rig to
   the camera; the model never authors the camera motion.
2. **The weapon is an attach socket.** A held gun is **not part of the skinned
   mesh**. It is an **empty bone** — a `weapon_socket` bone with **no vertex
   influence**, the skinned analogue of the [empty-part
   socket](/testing/asset-generation/voxel-binaries/#rig-subcommands) — that the game
   **hangs a separate weapon asset on**. So one pair of hands holds different
   weapons: fire and reload move the hands **and the socket**, and the game attaches
   whatever weapon model it likes to the socket node.

Because these two conventions cover the first-person case cleanly on top of the
ordinary skinned rig, there is **no first-person binary** — an FPS viewmodel is
authored with `mc-skin`, `sn-skin`, or `dc-skin` like any other character, and its
[`[model]`](/testing/asset-generation/manifests/) required animations name the
FPS-flavored set.
