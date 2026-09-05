---
title: Mesh binaries
description: The CSG/signed-distance-field authoring interface and per-part .glb (binary glTF) output contract for the Marching Cubes, Surface Nets, and Dual Contouring meshing binaries (mc/sn/dc and their -anim variants).
---

A mesh asset-generation run sculpts through a meshing binary on its `PATH`. That
binary is the only channel for shaping the surface. Where the
[voxel tools](/testing/asset-generation/voxel-binaries/) paint discrete opaque
cubes, a meshing binary builds a continuous signed-distance field by
compositing primitives, a CSG-style paradigm, and extracts a triangle mesh from
it.

There are three algorithms, each with a static and an animated binary:

| Algorithm | static binary | animated binary | `asset_kind` (static / animated) | character |
| --- | --- | --- | --- | --- |
| Marching Cubes | `mc` | `mc-anim` | `mc-model` / `mc-animation` | low poly: coarse sample grid, chunky faceted surfaces |
| Surface Nets | `sn` | `sn-anim` | `sn-model` / `sn-animation` | smooth mid-fidelity: watertight, uniform triangle density, rounded features |
| Dual Contouring | `dc` | `dc-anim` | `dc-model` / `dc-animation` | high fidelity: fine grid, preserves sharp edges and corners |

A static binary builds one field and extracts it as a single mesh. An animated
binary takes the same field operations plus a required `--part <name>` on every
operation, so each part is a separate field with its own log and preview, and it
adds rig subcommands that build the parts-and-joints hierarchy and author the
animations.

The mesher lives in `crates/voxel-mesh`, holding the SDF field type, sampling,
and the three extraction algorithms. The shared record and preview plumbing, rig
model, color, config, and generic renderer live in `crates/model-core`, the same
library the voxel binaries use. Each binary has its own crate (`crates/mc`,
`crates/mc-anim`, and so on) and is baked into its own
[run-container image](/components/core/execution/#containerization), one image
per `asset_kind`, so a run carries only the tool it uses.

## The signed-distance field

A meshing binary maintains a signed-distance field over the volume: at every
point in space the field records the signed distance to the nearest surface,
negative inside the solid and positive outside. The surface a binary meshes is
the field's zero level set. A model shapes that field by compositing primitives,
adding material with a sphere or a box and carving it away with another. Each
primitive carries an opaque `#rrggbb` color. The field starts empty, and the
`background` a case declares is the preview PNG's clear color alone.

Coordinates match the voxel tools: `x` across, `y` up, `z` in depth. The
[`[voxel]`](/testing/asset-generation/manifests/voxel-cases/) volume table frames
the field's bounds, and a meshing case reuses that same table. Because the field
is continuous, primitive centers and extents are real-valued within those bounds
rather than snapped to an integer grid. The sample resolution the algorithm
evaluates the field at is a fixed characteristic of the binary.

## Field operations

A case seeds no operations schema. The vocabulary is the binary's own `--help`,
and the brief tells the model to read it:

```
mc --help                    # every operation
mc add-sphere --help         # one operation's exact flags
```

Each operation is a subcommand with flags:

```
mc add-box --cx 8 --cy 4 --cz 10 --width 16 --height 6 --depth 12 --color "#3a4a5a"
mc add-sphere --cx 16 --cy 10 --cz 16 --r 6 --color "#c0c0c8" --blend 2
mc subtract-cylinder --cx 16 --cy 6 --cz 16 --r 3 --height 12 --axis y
```

All three algorithms share the vocabulary. Only Dual Contouring adds the
[sharp-feature tag](#sharp-features).

- Additive primitives: `add-sphere`, `add-box`, `add-ellipsoid` (unequal
  per-axis radii, for domes, eggs, and boulders), and `add-cylinder` (a disc
  extruded along a chosen axis, for barrels, legs, and poles). Each takes a
  center, an extent, and an opaque `#rrggbb` `--color`, and unions its shape into
  the field.
- Subtractive primitives: `subtract-sphere`, `subtract-box`,
  `subtract-ellipsoid`, and `subtract-cylinder` carve the same shapes out of the
  field, cutting hollows, bores, and notches.
- `--blend <radius>` on any primitive selects a smooth union or subtraction, a
  soft-min blend of the given radius, so material flows into a rounded fillet.
  It defaults to `0`, a hard union, which produces a genuine crease in the field.
- `replace-color --from <color> --to <color>` recolors every node carrying one
  color across the whole field, for a palette swap or a shading pass. The
  distance field is untouched.
- Whole-field edits: `mirror` reflects the low side of a symmetry plane onto the
  high side by union, `translate` shifts the whole field by a vector, and `copy`
  unions a source region into a destination offset, for a second wheel or a
  repeated rivet.
- `clear` resets the field to empty.

Primitive centers and extents are real-valued and signed. A primitive may sit
partly outside the volume, and the out-of-bounds portion is simply not meshed.
Because the field is a single composited scalar function, the recorded log
rebuilds to the same field, an order-dependent composite, from which the binary
extracts the mesh.

## The three algorithms

All three read the same shared field and differ only in how they turn its zero
level set into triangles. The output character is a fixed characteristic of each
binary rather than a configurable mode: pick the binary for the surface you want,
and a case's `asset_kind` names it. All three sample a uniform grid, with a
world-space cell size of `2.0` for Marching Cubes, `1.0` for Surface Nets, and
`0.5` for Dual Contouring.

### Marching cubes

Marching Cubes samples the field on a coarse grid and, for each grid cell the
surface crosses, emits triangles from a fixed lookup of the cell's sign pattern,
placing each vertex on a cell edge by interpolating the field's sign change
along it. Vertices land only on grid edges, so the result is a chunky, faceted
surface whose triangle density tracks the coarse grid. It is watertight and
visibly tessellated, which suits a brief that wants a blocky, stylised read.

### Surface nets

Surface Nets samples the field on a medium grid and places one vertex per
surface-crossing cell, positioned at the field-weighted centroid of the cell's
edge crossings, then stitches neighbouring cell vertices into quads split to
triangles. A vertex is free to sit anywhere inside its cell, so the surface
relaxes into rounded, smooth features with uniform triangle density. The result
is a watertight, mid-fidelity mesh that reads as organic and clean.

### Dual contouring

Dual Contouring also places one vertex per surface-crossing cell, on a fine
grid, and positions that vertex by solving a quadratic error function over the
field's surface samples and their normals within the cell. Because the solve is
driven by surface normals, a vertex is pulled onto the exact intersection of the
surfaces meeting in the cell, so sharp edges and corners are preserved crisply.
Its fine grid captures fine detail, at a higher triangle and compute cost than
the other two. It reproduces the creases a hard union already puts in the field
without any extra tagging.

### Sharp features

`dc` and `dc-anim` add a `--sharp` flag on primitives, giving explicit control
over whether an edge or corner is preserved crisply, independent of a
primitive's `--blend` radius. `--blend` shapes the field, deciding how two solids
join; the sharp tag tells Dual Contouring how to extract an edge the field
already contains. A primitive is smooth unless `--sharp` is passed.

Only Dual Contouring honors the tag. Marching Cubes and Surface Nets place
vertices in a way that rounds every feature, so `mc`, `mc-anim`, `sn`, and
`sn-anim` leave the flag off the surface entirely.

### Simplification

A uniform grid spends triangles evenly, so a large flat region carries as many
triangles as an equally sized curved one. After extraction, every binary runs a
quadric-error-metric simplification pass that collapses that redundancy before
the mesh is encoded to its `.glb`. Flat areas collapse the most; tightly curved
and sharp regions stay dense. The pass applies to the exported mesh, the
preview, and the recorded vertex count alike, so all three agree.

The pass performs an edge collapse only when the collapse provably preserves the
surface's watertight, 2-manifold topology, the link condition, so it never opens
a crack. It never collapses across a color boundary, which keeps color patches
crisp, nor across a sharp feature, whose high collapse error keeps Dual
Contouring's creases. The error budget is a fixed fraction of the mesh's
bounding-box diagonal, and a mesh under 64 triangles is left untouched. All of
this is a fixed characteristic of the binaries.

## Recording and on-request rendering

Each operation appends itself to the run's operation log, and that is all a
sculpting call does. Extracting a surface from the field and rasterizing it
through the software renderer is far more expensive than stamping 2D pixels, and
a model takes many operations, so rendering is a separate, on-request step.

The orchestrator seeds a config next to the workspace, `mc.config.json` for the
static tool or `mc-anim.config.json` for the animated one and likewise for `sn`
and `dc`, giving the volume dimensions, background, and the log, preview, and
mesh paths, plus the `rig.json` path for the animated tools. Neither an
operation nor `render` needs volume flags.

`render` rebuilds the derived artifacts from the recorded log: it composites the
field, extracts and simplifies the surface into the per-part `.glb`, and draws
the preview PNG. A model runs it to see its progress and, before finishing, to
emit the `.glb` the run's result is built from. An unrendered model leaves no
geometry, which the validator records as an empty part.

```
mc init            # write an empty log (a run starts pre-seeded); renders nothing
mc render          # extract the surface to the .glb and draw the preview PNG
mc render --view front   # ...from a chosen camera: iso (default) | front | side | top
```

Recording and then rendering serves authoring ergonomics: the preview lets the
model, and a watching human, see the surface it has built. The
[validator](/testing/asset-generation/evaluation/) regenerates nothing. It
decodes the emitted per-part [`.glb`](#the-glb-output-contract) and parses
`rig.json`, confirms they are well-formed and readable, and checks that each
required animation is present and actually animates. What is judged is the
emitted data plus a reviewer's read of the rendered previews.

### The preview

The preview is a 3D orbit view of the extracted mesh, 512 pixels square,
produced by a generic mesh renderer in the shared `crates/model-core` library.
It renders with `wgpu` targeting Mesa lavapipe, a software Vulkan
implementation, so it runs CPU-only and headless with no GPU in the container.
The same renderer serves every voxel-family binary, so previews are comparable
across all algorithms.

The still preview is what a model reads and a reviewer sees. The interactive,
rotatable, posable 3D view is the frontend's rendering of the emitted `.glb`. See
[voxel-runtime](/components/voxel-runtime/overview/).

## Live preview

A watched run streams the model's sculpting to the viewer in real time,
mechanically identical to the
[voxel tools](/testing/asset-generation/voxel-binaries/#live-preview). The
orchestrator adds a `live` block to the seeded config, carrying a
`host.docker.internal` endpoint and an opaque per-run token. When the model runs
`render`, the binary connects back to the run host and streams a one-line JSON
header (`{ token, frame, operation, operationCount, length, meshLength,
rigLength }`) followed by the rendered preview PNG's raw bytes and then
`meshLength` bytes of the part's current `.glb`.

The mesh body lets the viewer rebuild the surface in 3D as it is sculpted,
orbiting it and assembling the scene as the finished-run view does. A PNG-only
viewer ignores it. For an animated model the `frame` field carries the part
index, so the viewer shows the most-recently-sculpted part, the status of every
part, and the assembled scene at once. A static model uses part index `0`.

Streaming is best-effort. It is absent for an unwatched run, an operation
succeeds whether or not the listener responds, and the frames are never
recorded. The recorded operation log and the emitted `.glb` remain the run's
authoritative output.

## Animated binaries: one field per part, plus the rig

An animated model is a [rig](/testing/asset-generation/overview/#the-rig): named
parts in a hierarchy with named joints and model-authored animations. Each
animated binary is its static counterpart plus a global required `--part <name>`
selecting which part an operation sculpts into. Each part is an
independently-authored field, meshed on its own into its own `.glb`, with its own
operation log and its own preview, both `{part}` templates the case declares.

The rig composes and poses the per-part meshes, so parts are the pieces that
animate rather than subsections of one mesh. The case's `[model]` table fixes
only the required animations. The model creates each part with `define-part`
before it sculpts into it, and a field operation on an undefined part is
rejected.

```
mc-anim --help                         # same field operations, plus --part
mc-anim define-part --name turret --parent hull   # create a part before sculpting
mc-anim add-box --part turret --cx 16 --cy 10 --cz 16 \
                --width 8 --height 4 --depth 8 --color "#4a5a3a"
mc-anim render                         # every part's .glb + the assembled scene
mc-anim render --component turret      # ...or just one part's preview + .glb
mc-anim render --time 600 --animation walk   # ...or posed at 600ms of the walk
```

`render` is identical in shape to
[`voxel-anim render`](/testing/asset-generation/voxel-binaries/#the-render-command).
Plain `render` re-emits every part's `.glb` and preview and writes the assembled
rest scene, which is the call to run before finishing. `--component <part>`
renders one part. `--time <ms>`, with `--animation`, renders the model posed at
that instant of an animation, to `scene/pose.png`. Nothing renders
automatically.

The rig model is identical to the one
[`voxel-anim`](/testing/asset-generation/voxel-binaries/) authors:
the same `define-part`, `set-pivot`, `define-joint`, `define-animation`, and
`add-keyframe` subcommands, the same F-curve interpolation, the same
rotation-sign convention, and the same `caller` and `auto` joint drives. Author
the rig and its animations exactly as for a voxel animation. The design guidance
for legged rigs and walk cycles is in
[Rigging and animating walkers](/testing/asset-generation/rigging-walkers/).

The orchestrator seeds `rig.json` pre-populated with the case's required
animation declarations alone. Its `parts` and `joints` start empty, because a
case declares none. `define-part` initializes each part's operation log as the
model creates it; the part's preview and `.glb` are written later, by `render`.
The model builds the whole rig, inventing the parts and joints the subject needs
and authoring each required animation, and may add further animations of its
own. The required animations are the game-facing contract a reviewer scores
against.

## The `.glb` output contract

Each binary emits a per-part `.glb`, a standard glTF 2.0 binary container
holding one mesh with one primitive, as the single source of the extracted
geometry. A static model is a single implicit part. The file is written to
`meshes/{part}.glb` for an animated model and `mesh.glb` for a static one. Its
primitive carries the same four attributes the runtime's `PartMesh` holds, as
glTF accessors:

- `POSITION`, an F32 `VEC3` per vertex, with the required per-axis `min`/`max`.
- `NORMAL`, an F32 `VEC3` per vertex.
- `COLOR_0`, an F32 `VEC3` per vertex, carrying the same linear `0..1` RGB the
  runtime `PartMesh` uses.
- The index accessor, a U32 `SCALAR` triangle-vertex list.

A part with no geometry, an empty part serving as an attach socket, is emitted
as a valid glb with an empty scene and no meshes; decoding it yields empty
arrays. Because the format is standard glTF 2.0, the Rust encoder and the
TypeScript and Node decoders interoperate through the glTF spec rather than
through each other's code.

The `.glb` is the single source of geometry for every consumer, and the Rust
mesher runs once. The preview renderer draws the in-memory mesh,
[`@clockwyrks/voxel-runtime`](/components/voxel-runtime/overview/) decodes the
file directly into a `PartMesh` with no re-meshing in TypeScript, and
`scripts/voxel-to-gltf.mjs` decodes each part's `.glb` and packs it with
`rig.json` into a single whole-rig
[glTF](/components/voxel-runtime/overview/#exporting-to-gltf) with one mesh per
part, baked animations, and a joint-interface sidecar. The cube binaries emit
the same per-part `.glb`, so one glTF exporter and one runtime serve every
voxel-family type.
