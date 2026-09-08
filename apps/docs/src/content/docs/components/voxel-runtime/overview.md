---
title: Overview
---

The voxel runtime (`@clockwyrks/voxel-runtime`, in `packages/voxel-runtime`)
is the shared TypeScript library that turns a
[voxel-family](/testing/asset-generation/overview/#voxel-and-meshed-models)
run's produced artifacts into a posable, renderable 3D model. The geometry
arrives ready-made as glTF 2.0 binaries from the [meshing
binaries](/testing/asset-generation/voxel-binaries/), and the runtime decodes it
rather than meshing anything itself.

It is a code-sharing library rather than a component: it ships no service and
runs in no process of its own. Both the in-repo 3D viewer that reviews voxel
runs and games that embed a produced model consume it, so the posing math and
the mesh loading live in one place.

## The pure-core and three split

The package ships two subpath entries so a consumer takes only what it needs.

`@clockwyrks/voxel-runtime`, the root, is the pure core: the contract types, the
framework-agnostic posing and animation math, linear-blend skinning, and the
`parseGlb` and `parseSkinnedGlb` decoders that turn a part's `.glb` into a
`PartMesh` or `SkinnedMesh` of plain typed arrays. It carries no rendering
dependency, so a game with its own renderer, a headless consumer, or the [glTF
exporter](#exporting-to-gltf) uses it alone.

`@clockwyrks/voxel-runtime/three` is the three.js binding: `buildPartGeometry`,
which wraps a core `PartMesh` into a `BufferGeometry`, plus the `VoxelRig` and
`SkinnedVoxelRig` scene objects built on the core. `three` is a peer dependency,
so a consuming game shares its single `three` instance with the runtime.

The core's contract types are re-exported from
[`@clockwyrks/run-record`](/components/core/run-records/), so the runtime and
the backend agree on the shapes by construction.

## Loaded artifacts

A rigid model's artifacts are its `rig.json` and one `.glb` per part.

`rig.json` is the rig the model produced: the parts, a parent/child hierarchy
each carrying an attachment pivot; the joints, named single-axis degrees of
freedom that are either caller-driven or `auto`; and the model-authored
animations, named F-curve timelines. Parts and joints are model-invented, and
the case fixes only its required animations, by name.

Each part's `.glb` carries that part's surface mesh, which `parseGlb` decodes
into a `PartMesh`: flat `positions` and `normals`, per-vertex linear `0..1` RGB
`colors`, and triangle `indices`. Rigged models emit `meshes/{part}.glb`; a
static model emits a single `mesh.glb`. An empty part is a socket and decodes to
an empty `PartMesh`.

A skinned model (the `mc-skinned`, `sn-skinned`, and `dc-skinned` kinds) emits a
single `mesh.glb`, which `parseSkinnedGlb` decodes into a `SkinnedMesh`: the
same geometry plus `JOINTS_0`, up to four influencing bone indices per vertex,
`WEIGHTS_0`, their normalized weights, and the skeleton those indices address.
The rig's parts are the bones, matched to the skeleton by name.

The runtime consumes finished triangles only. Every mesher a case may run,
whether cube, Marching Cubes, Surface Nets or Dual Contouring, yields the same
`PartMesh` shape, so a single load-and-render path serves all of them.

This library is the browser and three renderer. The binaries render their own
preview PNGs of the same `.glb` geometry headlessly.

## Posing

The core's central primitive resolves the rig's world transforms for a pose:

```ts
poseRig(rig, { caller, timeMs }) -> PosedPart[]
```

Each part's world transform is its parent's world composed with each of its
joints, in declared order. Parts are sculpted in the shared volume's world
coordinates, so a part contributes no placement translation of its own: its
`pivot` is the world-space anchor its joints rotate about, and at rest a part
stays exactly where it was sculpted.

A joint's contribution is `mount ∘ driven`. The mount is fixed: an optional
`orient` rotation about the pivot, in radians as Euler X→Y→Z, and an optional
`offset` translation in voxels. The driven part is the joint's single-axis
rotation or translation at its current value. A joint with a mount and an empty
driven range is a purely static attachment, which is how a component is mounted
at a custom rotation and translation.

Every joint reads its value from the `caller` map, falling back to the joint's
`rest` and clamped to `[min, max]`. A game supplies caller-driven joints
directly. An `auto` joint holds at `rest` until an animation overlays a value
onto the same map.

Transforms are plain flat `Float32Array(16)` matrices, so the result is usable
by any renderer without pulling in three.

### Animation sampling

Each animation in `rig.json` is a named timeline of tracks, one per joint it
drives, and each track is an F-curve. `sampleKeyframes` evaluates a track at a
query time, honouring each keyframe's per-segment interpolation: `constant`
holds the value until the next key, `linear` runs a straight line to it, and
`bezier` follows a curve shaped by tangent handles, with auto tangents derived
from the neighbouring keys when handles are omitted. The `ease-in`, `ease-out`,
and `ease-in-out` presets expand to fixed Bézier handles mirroring the matching
CSS `cubic-bezier` curves. A looping animation wraps the query time into its
period and evaluates the closing segment from the last keyframe back to the
first, so the loop is seamless.

`sampleAnimation(animation, timeMs)` samples a whole animation into a map of
joint name to value, which is exactly what `poseRig` takes as `caller`.

An animation is either `auto_play`, played continuously by default, or a named
playable triggered on demand. Playing one overlays only the joints its tracks
drive, so every other joint holds at its caller or rest pose.

### Skinning

A skinned character is one continuous mesh whose vertices blend their bones'
transforms, driven from the same `rig.json` through the same `poseRig`
composition.

`skinningMatrices(rig, mesh, input)` returns one matrix per bone, in the mesh's
bone order, each the bone's posed world matrix times its inverse-bind matrix. A
bone with no matching rig part contributes the identity, so it holds at bind
pose. `skinMesh` applies those matrices on the CPU with no `three` dependency,
and the three binding's `SkinnedVoxelRig` applies the identical math on the GPU.

## The `VoxelRig` API

The three binding wraps the core in a scene object a game drives directly.
`buildPartGeometry` produces one vertex-colored `BufferGeometry` per part, and
`VoxelRig` assembles the parts under the rig hierarchy.

- `root` — a `THREE.Group` the game adds to its scene.
- `pose(caller)` — set the caller-driven joint values, clamped to each joint's
  range.
- `playAnimation(name)` — play one of the model's animations by name, or `null`
  to stop.
- `update(dtSeconds)` — advance the playback clock, posing each driven joint
  from its F-curve while the rest hold at their caller or rest pose.
- `seek(timeMs)` — set the playback clock directly.
- `jointNames(drive)` — the joint names for a drive. `jointNames("caller")` is
  the procedural interface a game drives per frame; `"auto"` lists the joints
  only animations drive.
- `jointRange(name)` — a joint's `{ min, max, rest }`.
- `dispose()` — release the GPU geometries and materials.

`SkinnedVoxelRig` offers the same driving surface over a `THREE.SkinnedMesh` and
`THREE.Skeleton`. Its bones are held under a self-contained root kept at
identity outside `root`, so a consumer's transform on `root` places the
character without double-transforming the skin.

The review viewers mount these same objects, so a game and the review UI pose a
produced model identically.

## Exporting to glTF

To embed a produced voxel model in a game engine as a ready-made animated mesh,
the repo ships `scripts/voxel-to-gltf.mjs`. It packs a run's artifacts into a
single whole-rig glTF 2.0 or GLB, so one exporter serves the cube and MC/SN/DC
families alike:

```sh
# A rigged, animated model (rig.json carries the parts, joints, and animations):
node scripts/voxel-to-gltf.mjs --rig rig.json --meshes meshes/ --out model.glb
# A static model (one mesh.glb, no rig):
node scripts/voxel-to-gltf.mjs --meshes mesh.glb --out model.glb
```

Output is GLB by default, or a `.gltf` plus `.bin` pair when `--out` ends in
`.gltf`. The tool accepts either the raw produced `rig.json` or a run record's
resolved `ModelSpec` rig, and it is dependency-free. It decodes each part's
geometry and poses the rig with the same logic the core does.

The output carries one mesh per part, vertex-colored, and a node hierarchy
matching the part tree, each node named after its part so a game can find and
drive it. A part with no geometry exports as an empty attach-socket node, marked
in the node's `extras`, which a game hangs VFX on or spawns projectiles from.
Each part's geometry is baked into its rest-local frame, so a node's default
transform reproduces the rest pose.

Alongside the mesh the exporter emits the two things a game consumes, one per
consumption path:

- Baked animations. Each of the model's animations becomes a glTF animation
  whose F-curves are dense-sampled, so the eased motion reaches the engine
  intact. Its `loop` and `autoPlay` intent rides in the animation's `extras`,
  because glTF carries no native loop flag.
- The joint interface. A `<model>.interface.json` sidecar, mirrored into each
  driven node's glTF `extras`, lists every caller joint with its node, kind,
  axis, and its `min`, `max` and `rest` values. It is the portable form of
  `jointNames("caller")` and `jointRange`.

A game can therefore play the baked clips or drive the caller joints itself by
transforming the named nodes within their limits, exactly as `VoxelRig` does.
The exporter is an authoring and build step for the games that consume the
assets, outside what a voxel test case can reach.
