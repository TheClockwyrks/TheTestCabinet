---
title: Overview
---

The voxel runtime (`@test-cabinet/voxel-runtime`, in `packages/voxel-runtime`) is
the shared TypeScript library that turns a
[voxel-animation](/testing/asset-generation/overview/#voxel-models-and-rigs) run's
produced artifacts — its `rig.json` and per-part `voxels.json` — into a **posable,
renderable 3D model**. It is consumed by the in-repo
[3D viewer](/components/ui/overview/) that reviews voxel runs *and* by real games
that embed a produced model, so the posing math and the mesh building live in one
place rather than being reimplemented per consumer.

It is a code-sharing library, not a component itself: it ships no service and runs
in no process of its own.

## The pure-core / three split

The package ships **two subpath entries** so a consumer takes only what it needs:

- **`@test-cabinet/voxel-runtime`** (the root) — the **pure core**: the contract
  types, the framework-agnostic posing math, and framework-agnostic **mesh
  building** (`buildPartMesh` → plain `{ positions, normals, colors, indices }`
  typed arrays), with **no rendering dependency**. A game with its own renderer, a
  headless consumer (a test, a server), or the [glTF exporter](#exporting-to-gltf)
  uses this alone.
- **`@test-cabinet/voxel-runtime/three`** — the **three.js binding**: a
  `buildPartGeometry` that wraps the core `buildPartMesh` into a `BufferGeometry`
  and a `VoxelRig` scene object built on the core. `three` is a **peer
  dependency** (not bundled), so a consuming game shares its single `three`
  instance with the runtime rather than ending up with two copies in one scene.

The tooling mirrors [`@test-cabinet/run-record`](/components/core/run-records/) — a
composite `tsc -b` build — and the core's contract types are the same ones the
[run record](/components/core/run-records/) generates, so the runtime and the
backend agree on the shapes by construction.

## The contract it loads

The runtime consumes exactly the two artifacts the
[validator regenerates](/testing/asset-generation/evaluation/#voxel-regeneration):

- **`rig.json`** — the full rig the model produced: the parts (a parent/child
  hierarchy, each with an attachment pivot), the joints (named degrees of freedom,
  each caller-driven or `auto`), and the model-authored **animations** (named
  F-curve timelines), matching the
  [`ModelSpec`/`PartSpec`/`JointSpec`](/components/core/run-records/) contract. This
  is the required parts, joints, and animations the case declared **plus** any the
  model added.
- **`voxels.json`** — the sparse voxel data for a part (or the whole model, for a
  static case): the bounding `dims` and the occupied cells, each an opaque
  `#rrggbb` color, matching the `VoxelsFile` contract. One per part.

Both are governed by the run-record contract schema, so a consuming game can rely
on their shapes the same way the review UI does.

## Posing

The core is framework-agnostic. Its central primitive resolves the rig's world
transforms for a given pose:

```ts
poseRig(rig, { caller, time }) -> PosedPart[]
```

Each part's world transform is its parent's world composed with each joint's
contribution — `parentWorld ∘ joint(param)`. Parts are sculpted in the shared
volume's world coordinates (each part's voxels already sit where the part belongs
on the assembled model), so a part contributes no placement translation of its
own: its `pivot` is the world-space anchor its joints rotate about, not an offset
that re-places the part, and at rest a part stays exactly where it was sculpted.

A joint's contribution is a **compound transform**: a fixed mount — its optional
`offset` (a translation in voxels) and `orient` (a fixed rotation, radians, applied
as Euler X→Y→Z about the pivot) — composed with its driven single-axis motion, as
`mount ∘ driven`. A joint with no mount (the common case) contributes only the
driven motion; a joint with a mount and an empty driven range is a purely static
attachment (how a component is mounted at a custom rotation and translation). A
joint's driven parameter comes from one of two sources, by its `drive`:

- **caller-driven** joints take their value from the `caller` map the consumer
  supplies (a game setting `turret_yaw`), **clamped** to the joint's `[min, max]`
  and defaulting to `rest` when the caller omits it;
- **`auto`** joints carry no procedural value of their own — they are driven only
  by the model's animations, and hold at `rest` until one overlays them.

### Animation sampling

The model's own **animations** ride in `rig.json`: each is a named timeline of
**tracks**, one per joint it drives, and each track is an **F-curve** — the
graph-editor curve real DCC tools use, not a linear-only key list. The pure-core
`sampleKeyframes` evaluates an F-curve at a query time, honouring each keyframe's
per-segment interpolation:

- `constant` — hold the value until the next key (a step),
- `linear` — a straight line to the next key,
- `bezier` — a smooth curve shaped by tangent handles (auto tangents when handles
  are omitted),

plus the `ease-in` / `ease-out` / `ease-in-out` **presets**, which expand to fixed
Bézier tangent handles so a model eases without hand-solving tangents. Sampling is
no longer linear-only, so eased motion — a walk's weight, a recoil's snap — reaches
the pose instead of being flattened to straight ramps.

An animation is either **`auto_play`** — played continuously by default (the
decorative idle, a radar spin) — or a named **playable** (walk, recoil) triggered
on demand. Playing one **overlays only the joints its tracks drive**: every joint
it does not touch holds at its caller/rest pose, so a game can play a `recoil` clip
while it keeps driving the `turret_yaw` caller joint from aim state.

Transforms are plain flat `Float32Array(16)` matrices, so the result is usable by
any renderer without pulling in three.

## The `VoxelRig` API (for game integrators)

The three binding wraps the core in a scene object a game drives directly. Mesh
building (`buildMesh`) turns a part's `voxels.json` into one `BufferGeometry` per
part with per-voxel vertex colors — greedy-meshed where it can be, falling back to
merged box geometry, behind the same API either way — and `VoxelRig` assembles the
parts under the rig hierarchy:

- **`root`** — a `THREE.Group` the game adds to its scene (the whole posed model).
- **`pose(caller)`** — set the caller-driven joint values (for example
  `rig.pose({ turret_yaw: 0.64 })`); values are clamped to each joint's range.
- **`playAnimation(name)` / `update(dt)`** — play one of the model's
  [`AnimationSpec`](/testing/asset-generation/manifests/) animations by name (or
  `null` to stop): each of its tracks poses its joint from the F-curve sampled at
  the current clock, overlaying only the joints the animation drives while the rest
  hold at their caller/rest pose, so driving `update(dt)` walks the whole
  choreography forward. An `auto_play` animation runs continuously by default. The
  pure-core `sampleAnimation(animation, timeMs)` samples one into a
  `{ joint: value }` map if you would rather pose the rig yourself.
- **`jointNames(drive)`** — the joint names for a `drive`. `jointNames("caller")`
  **is the procedural interface** — the joints a game drives per frame (turret yaw,
  gun pitch); `"auto"` lists the ones only animations drive.
- **`jointRange(name)`** — a joint's `{ min, max, rest }`, e.g. to build a slider.
- **`dispose()`** — release the GPU geometries and materials when the model is
  torn down.

This is the same object the [`VoxelViewer`](/components/ui/overview/) mounts to
render voxel runs — a `voxel-model` auto-rotating, a `voxel-animation` orbit-drag
with a control per caller joint — so a game and the review UI pose a produced model
identically.

## Exporting to glTF

For embedding a produced voxel model in an **end-to-end game** (or any engine) as a
ready-made, animated mesh asset — rather than shipping `rig.json` + per-part
`voxels.json` and posing at runtime — the repo ships a standalone converter,
`scripts/voxel-to-gltf.mjs`. It reads a run's produced artifacts and writes a
standard **glTF 2.0 / GLB**:

```sh
# A rigged, animated model (rig.json carries the parts, joints, and animations):
node scripts/voxel-to-gltf.mjs --rig rig.json --voxels voxels/ --out model.glb
# A static model (one voxels.json, no rig):
node scripts/voxel-to-gltf.mjs --voxels voxels.json --out model.glb
```

The output carries **one mesh per part** (culled, vertex-colored, built from the
same core `buildPartMesh`) and a **node hierarchy** matching the part tree (each
node named after its part, so a game can find and drive it). A part sculpted with
**no voxels** exports as an empty **attach socket** node — a `muzzle` or `exhaust`
a game hangs VFX on or spawns projectiles from. Each part's geometry is baked into
its rest-local frame, so a node's default transform reproduces the rest pose.

Alongside the mesh the exporter emits the two things a game consumes, one per
**consumption path**:

- **Baked animations** — the *played clips*. Each of the model's animations becomes
  a glTF **animation**, carrying its `loop` intent, with its F-curves **baked** so
  the eased motion survives to the engine: the curves are **dense-sampled** (or
  emitted as **CUBICSPLINE** tangents derived from the F-curve) so Unreal and others
  reproduce the weight and snap instead of re-linearising it, and the `auto_play`
  animation is marked as the default idle. A game plays these as AnimSequences /
  AnimMontages.
- **The joint interface** — the *procedural drives*. A sidecar
  **`<model>.interface.json`** (mirrored into each driven node's glTF `extras`)
  lists every **`caller`** joint as `{ node, kind, axis, min, max, rest }` — exactly
  what a game reads to rotate the turret or pitch the gun within its limits (Unreal
  imports it as a DataTable and wires a Modify-Bone / Control Rig node with the
  right axis and clamps). It is the portable form of `jointNames("caller")` /
  `jointRange` the review UI drives.

So a game can play the baked clips *or* drive the caller joints itself by
transforming the named nodes within their limits, exactly as `VoxelRig` does. The
tool is dependency-free (its mesh and rig math mirror the tested core) and accepts
either the raw produced `rig.json` or a run record's resolved `ModelSpec` rig. It is
**not** exposed to voxel test cases — it is an authoring/build step for the games
that consume the assets. Output is GLB by default, or a `.gltf` + `.bin` pair when
`--out` ends in `.gltf`.

## Status

Implemented in `packages/voxel-runtime`. The pure core has no rendering
dependency (it also builds meshes via `buildPartMesh`); the three binding takes
`three` as a peer dependency. It is consumed by the
[UI library](/components/ui/overview/)'s `VoxelViewer`, is publishable for games
that embed a produced voxel model, and underpins the
[`scripts/voxel-to-gltf.mjs`](#exporting-to-gltf) glTF exporter.
