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
  hierarchy, each with an attachment pivot) and the joints (named degrees of
  freedom, each caller-driven or auto-play), matching the
  [`ModelSpec`/`PartSpec`/`JointSpec`](/components/core/run-records/) contract. This
  is the required parts and joints the case declared **plus** any the model added.
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
- **auto-play** joints sample their value from their keyframe clip at `time`,
  looping over the clip period (or holding the last keyframe when the clip does not
  loop).

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
- **`play(clip)` / `update(dt)`** — start an auto-play clip and advance all
  auto-play joints by `dt` each frame.
- **`playAnimation(animation)` / `update(dt)`** — play a named, case-authored
  [`AnimationSpec`](/testing/asset-generation/manifests/) (or `null` to stop): each
  of its tracks poses its joint from the animation sampled at the current clock, so
  driving `update(dt)` walks the whole choreography forward. The pure-core
  `sampleAnimation(animation, timeMs)` samples one into a `{ joint: value }` map if
  you would rather pose the rig yourself.
- **`jointNames(drive)`** — the joint names for a `drive` (`"caller"` to discover
  the game-facing controls, `"auto"` for the self-animating ones).
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
# A rigged, animated model (rig.json + voxels/<part>.json):
node scripts/voxel-to-gltf.mjs --rig rig.json --voxels voxels/ --out model.glb
# …with the case's named animations baked in as well:
node scripts/voxel-to-gltf.mjs --rig rig.json --voxels voxels/ --out model.glb \
     --animations model.animations.json
# A static model (one voxels.json, no rig):
node scripts/voxel-to-gltf.mjs --voxels voxels.json --out model.glb
```

The output carries **one mesh per part** (culled, vertex-colored, built from the
same core `buildPartMesh`), a **node hierarchy** matching the part tree (each node
named after its part, so a game can find and drive it), and one glTF **animation**
per case-authored animation plus one (`auto-play`) for the rig's own auto-play
clips. Each part's geometry is baked into its rest-local frame, so a node's default
transform reproduces the rest pose and the animation channels drive it from there —
a game can play the baked clips *or* pose the caller joints itself by transforming
the named nodes, exactly as `VoxelRig` does. The tool is dependency-free (its mesh
and rig math mirror the tested core) and accepts either the raw produced `rig.json`
or a run record's resolved `ModelSpec` rig. It is **not** exposed to voxel test
cases — it is an authoring/build step for the games that consume the assets. Output
is GLB by default, or a `.gltf` + `.bin` pair when `--out` ends in `.gltf`.

## Status

Implemented in `packages/voxel-runtime`. The pure core has no rendering
dependency (it also builds meshes via `buildPartMesh`); the three binding takes
`three` as a peer dependency. It is consumed by the
[UI library](/components/ui/overview/)'s `VoxelViewer`, is publishable for games
that embed a produced voxel model, and underpins the
[`scripts/voxel-to-gltf.mjs`](#exporting-to-gltf) glTF exporter.
