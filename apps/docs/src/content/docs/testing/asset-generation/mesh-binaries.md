---
title: Mesh binaries
description: The CSG/signed-distance-field authoring interface and mesh.json output contract for the Marching Cubes, Surface Nets, and Dual Contouring meshing binaries (mc/sn/dc and their -anim variants).
---

A **mesh** asset-generation run sculpts through a **meshing binary** on its
`PATH` — the only channel for shaping the surface, a surface-extraction sibling of
the [voxel binaries](/testing/asset-generation/voxel-binaries/). Where the voxel
tools paint discrete opaque cubes, a meshing binary builds a **continuous signed-
distance field by compositing primitives** — a CSG-style paradigm — and extracts a
triangle mesh from it. That distinct paradigm is why the meshing binaries carry
their own vocabulary and their own crates.

There are three algorithms, each with a static and an animated binary, mirroring
the [`voxel`/`voxel-anim`](/testing/asset-generation/voxel-binaries/) split:

| Algorithm | static binary | animated binary | `asset_kind` (static / animated) | character |
| --- | --- | --- | --- | --- |
| **Marching Cubes** | `mc` | `mc-anim` | `mc-model` / `mc-animation` | **low poly** — coarse sample grid, chunky faceted surfaces |
| **Surface Nets** | `sn` | `sn-anim` | `sn-model` / `sn-animation` | **smooth mid-fidelity** — watertight, uniform triangle density, rounded features |
| **Dual Contouring** | `dc` | `dc-anim` | `dc-model` / `dc-animation` | **high fidelity** — fine grid, preserves sharp edges and corners |

Each **static** binary (`mc`, `sn`, `dc`) is for a static model: one field,
extracted as a single mesh. Each **animated** binary (`mc-anim`, `sn-anim`,
`dc-anim`) is for a rigged, animated model: the same field operations plus a
required `--part <name>` on every op, so **each part is a separate field** with its
own log and preview, and a set of **rig subcommands** that build the parts-and-
joints hierarchy **and author the animations**.

The mesher lives in `crates/voxel-mesh` (the SDF field type, sampling, and the
MC/SN/DC extraction), and the shared record/preview plumbing, rig model, color,
config, and the generic renderer live in `crates/model-core` — the same library
the voxel binaries use. Each binary has its own crate (`crates/mc`,
`crates/mc-anim`, and so on) and is baked into its own
[run-container image](/components/core/execution/#containerization) — one image per
`asset_kind` — so a run carries only the tool it uses.

## The field is a continuous signed-distance field

A meshing binary does not place cells. It maintains a **signed-distance field**
(SDF) over the volume: at every point in space the field records the (signed)
distance to the nearest surface, negative inside the solid and positive outside.
The surface a binary meshes is the field's **zero level set**. You shape that
field by **compositing primitives** — adding material with a sphere or box, carving
it away with another — and each primitive carries an **opaque `#rrggbb`** color
(there is **no alpha**; nothing composites translucently). The field starts
**empty** (everywhere outside, no surface), and the `background` a case declares in
its `[voxel]` table is only the preview PNG's clear color — it never adds material.

Coordinates match the voxel tools: `x` across, `y` **up**, `z` in depth. The
[`[voxel]`](/testing/asset-generation/manifests/#voxel-cases) volume table frames
the field's bounds — a meshing case reuses that same table (a mesh case declares
**no `[canvas]`**). Because the field is continuous, primitive centers and extents
are **real-valued** within those bounds, not snapped to an integer grid; the
sample resolution the algorithm evaluates the field at is a fixed characteristic of
the binary (see the per-algorithm sections below), not a per-case knob.

## The field operations are ordinary CLI subcommands

A case seeds **no** operations schema. The vocabulary is the binary's own `--help`,
exactly as with the [drawing](/testing/asset-generation/binaries/) and
[voxel](/testing/asset-generation/voxel-binaries/) tools, and the brief tells the
model to read it:

```
mc --help                    # every operation
mc add-sphere --help         # one operation's exact flags
```

Each operation is a subcommand with flags — there is no JSON. For example:

```
mc add-box --x 8 --y 0 --z 10 --width 16 --height 6 --depth 12 --color "#3a4a5a"
mc add-sphere --x 16 --y 10 --z 16 --r 6 --color "#c0c0c8" --blend 2
mc subtract-cylinder --x 16 --y 6 --z 16 --r 3 --height 12 --axis y
```

The vocabulary is **shared by all three algorithms** (`mc`, `sn`, `dc` and their
`-anim` variants); only Dual Contouring adds the [sharp-feature
tag](#dual-contouring-only-sharp-features):

- **Additive primitives** — `add-sphere`, `add-box`, `add-ellipsoid` (unequal
  per-axis radii — domes, eggs, boulders), and `add-cylinder` (a disc extruded
  along a chosen axis — barrels, legs, poles). Each takes a center, an extent, and
  an opaque `#rrggbb` **color**, and **unions** its shape into the field.
- **Subtractive primitives** — `subtract-sphere`, `subtract-box`,
  `subtract-ellipsoid`, `subtract-cylinder` — carve the same shapes **out** of the
  field, cutting hollows, bores, and notches.
- **`--blend <radius>`** — a flag on any primitive that selects a **smooth**
  union/subtraction (a soft-min blend) with the given radius, so material flows
  into a rounded fillet rather than meeting at a hard seam. It defaults to `0` =
  **hard**, and a hard union produces a genuine **crease** in the field (a
  first-order discontinuity at the seam) rather than a rounded join.
- **`replace-color`** — recolor a region of the field (a palette swap or a shading
  pass), leaving the surface geometry unchanged.
- **Whole-field edits** — `mirror` (reflect the field across a symmetry plane —
  handy for a symmetric hull), `translate` (shift the whole field by a vector), and
  `copy` (duplicate a source region to a destination offset — a second wheel, a
  repeated rivet).
- **`clear`** — reset the field to empty.

Primitive centers and extents are **real-valued** and **signed** (a primitive may
sit partly outside the volume; the out-of-bounds portion is simply not meshed,
never a panic). Because the field is a single composited scalar function, the
recorded log rebuilds to the **same field** — an order-dependent composite — from
which the binary extracts the mesh.

## The three algorithms

All three read the **same shared field**; they differ only in how they turn its
zero level set into triangles. The **output character is a fixed characteristic of
each binary, not a configurable mode** — you pick the binary for the surface you
want, and a case's `asset_kind` names it.

### Marching Cubes (`mc`) — low poly

Marching Cubes samples the field on a **coarse** uniform grid and, for each grid
cell the surface crosses, emits triangles from a fixed lookup of the cell's
sign pattern, placing each vertex on a cell **edge** by interpolating the field's
sign change along it. Vertices land only on grid edges, so the result is a
**chunky, faceted** surface whose triangle density tracks the coarse grid — the
characteristic **low-poly** look. It is watertight but visibly tessellated, ideal
for a case whose brief wants a blocky, stylised read.

### Surface Nets (`sn`) — smooth mid-fidelity

Surface Nets samples the field on a **medium** uniform grid and places **one vertex
per surface-crossing cell**, positioned at the field-weighted centroid of the cell's
edge crossings, then stitches neighbouring cell vertices into quads (split to
triangles). Because a vertex is free to sit anywhere inside its cell rather than on
an edge, the surface relaxes into **rounded, smooth** features with **uniform
triangle density** and no sharp edges — a **watertight, mid-fidelity** mesh that
reads as organic and clean. It is the middle ground: smoother than Marching Cubes,
without Dual Contouring's cost or crease preservation.

### Dual Contouring (`dc`) — high fidelity

Dual Contouring also places **one vertex per surface-crossing cell** on a **fine**
uniform grid, but it positions that vertex by solving a **quadratic error function
(QEF)** over the field's surface samples and their **normals** within the cell.
Because the QEF is driven by surface normals, a vertex is pulled onto the exact
intersection of the surfaces meeting in the cell, so **sharp edges and corners are
preserved crisply** instead of being rounded off — the **high-fidelity** result.
Dual Contouring reproduces the hard [creases a hard union already
produces](#the-field-operations-are-ordinary-cli-subcommands) in the field for
free, and its fine grid captures fine detail, at a higher triangle and compute cost
than the other two.

All three use a **uniform** grid; there is no octree or adaptive subdivision.
Resolution is tuned per algorithm (MC coarse, SN medium, DC fine) and is not a
per-case parameter.

## Dual Contouring only: sharp features

`dc` and `dc-anim` add a **sharp-feature tag** on primitives — a `--sharp` /
`--smooth` flag — that gives explicit control over whether an edge or corner is
**preserved crisply** or **rounded**, independent of a primitive's `--blend`
radius. `--blend` shapes the *field* (how two solids join); the sharp tag tells
Dual Contouring how to *extract* an edge the field contains. Only Dual Contouring
can honor it — Marching Cubes and Surface Nets cannot represent a preserved sharp
feature (their vertex placement rounds by construction), so `mc`/`mc-anim` and
`sn`/`sn-anim` **do not expose the tag at all**. (Dual Contouring still preserves
the creases a hard union produces without any tag; the tag is for control beyond
that.)

## How a call records and previews

Each operation appends itself to the run's **operation log** and re-renders the
**preview** from the whole log, so the recorded log is always the single source of
truth and the preview always reflects it. The orchestrator seeds a config next to
the workspace — `mc.config.json` (static) or `mc-anim.config.json` (animated), and
likewise for `sn`/`dc` — giving the volume dimensions, background, and the
log/preview and `mesh.json` paths, and, for the animated tools, the part list and
the `rig.json` path, so an operation needs no volume flags. A model reads the
preview between calls to judge its progress.

```
mc init      # write an empty log and a blank preview (a run starts pre-seeded)
mc render --actions <log> --out <png>    # rebuild the field from a log and re-render
```

This record-and-preview loop exists for **authoring ergonomics only** — it lets the
model (and a watching human) see the surface take shape operation by operation. It
is **not** a cheat-detection mechanism. The [validator](/testing/asset-generation/evaluation/)
does not regenerate or re-render anything: it parses the emitted
[`mesh.json`](#the-meshjson-output-contract) and `rig.json`, confirms they are
well-formed and readable, and checks the **rig contract** (that each required
animation is present and actually animates). What is judged is the emitted data plus a
reviewer's read of the rendered previews — not how the data was produced.

### Preview rendering (wgpu + Mesa lavapipe)

The preview each call re-renders is a real **3D orbit view** of the extracted mesh,
produced by a generic mesh renderer — geometry, an orbit camera, and lighting into
a PNG — that lives in the shared `crates/model-core` library. It renders with
**`wgpu`** targeting **Mesa lavapipe** (a **software Vulkan** implementation), so it
runs **CPU-only and headless**, with **no GPU in the container**. The same renderer
serves every voxel-family binary — the [cube tools](/testing/asset-generation/voxel-binaries/)
render their cube mesh through this path too — so previews are **apples-to-apples**
across all algorithms: the same orbit camera and shading over whatever surface the
binary extracted. Because nothing is regenerated for scoring, the renderer carries
no determinism requirement. (The still preview is what a model reads and a reviewer
sees; the interactive, rotatable, posable 3D view is the frontend's rendering — see
[the mesh.json contract](#the-meshjson-output-contract) and
[voxel-runtime](/components/voxel-runtime/overview/).)

## Live preview

When a run is being **watched** — driven by a [driver](/components/driver/overview/)
or the [Tauri app](/components/tauri/overview/) rather than a plain `tcab run` — the
model's sculpting is streamed to the viewer in real time, mechanically identical to
the [voxel](/testing/asset-generation/voxel-binaries/#live-preview) and
[drawing](/testing/asset-generation/binaries/#live-preview) tools: the orchestrator
adds a `live` block (a `host.docker.internal` endpoint and an opaque per-run token)
to the seeded config, and after each operation the binary connects back to the run
host and streams a one-line JSON header
(`{ token, frame, operationCount, operation, length, meshLength }`) followed by the
freshly rendered preview PNG's raw bytes and then the part's current `mesh.json`
text (`meshLength` bytes). The mesh body lets the viewer rebuild the surface **in
3D** as it is sculpted — orbiting it and assembling the scene exactly as the
finished-run view does — rather than showing only the flat preview PNG; a PNG-only
viewer simply ignores it. For an animated model the `frame` field carries the
**part index**, so the viewer can show the most-recently-sculpted part, the status
of every part, and the assembled scene at once (a static model uses part index
`0`). Streaming is **best-effort and non-essential** — absent for an unwatched run,
never fails an operation, and never recorded; the recorded **operation log** and the
emitted `mesh.json` remain the run's authoritative output.

## The animated binaries: one field per part, plus the rig

An animated model is a
[rig](/testing/asset-generation/overview/#the-rig-parts-and-joints): named parts in
a hierarchy with named joints and model-authored animations. Each animated binary
(`mc-anim`, `sn-anim`, `dc-anim`) is its static counterpart plus a global required
`--part <name>` that selects which part an operation sculpts into; **each part is an
independently-authored field**, meshed on its own into its own `mesh.json`, with its
own operation log and its own preview (both `{part}` templates the case declares).
The rig — the parts (each with a pivot), joints, and F-curve animations the model
**invents** — **composes and poses the per-part meshes**: parts are the pieces that
animate, not subsections of one mesh. The case's `[model]` table fixes only the
**required animations**; the model creates each part with `define-part` before it
sculpts into it.

```
mc-anim --help                         # same field operations, plus --part
mc-anim add-box --part turret --x 12 --y 8 --z 12 --width 8 --height 4 --depth 8 --color "#4a5a3a"
mc-anim define-part --name turret --parent hull   # create a part before sculpting into it
mc-anim init                           # seed rig.json (the required animation declarations)
```

The rig model is **identical to [`voxel-anim`](/testing/asset-generation/voxel-binaries/#voxel-anim-one-volume-per-part-plus-the-rig)**
— the same `define-part` / `set-pivot` / `define-joint` / `define-animation` /
`add-keyframe` subcommands, the same F-curve interpolation (`constant` / `linear` /
`bezier` plus the `ease-in` / `ease-out` / `ease-in-out` presets), the same
rotation-sign convention, and the same `caller`-vs-`auto` joint drives — so it is
not re-documented here. Author the rig and its animations exactly as for a voxel
animation:

- the rig subcommands, joints, and F-curves are documented under
  [The voxel binaries](/testing/asset-generation/voxel-binaries/#rig-subcommands)
  and in [Manifests](/testing/asset-generation/manifests/#voxel-cases), and
- the design guidance for legged rigs and walk cycles is in
  [Rigging and animating walkers](/testing/asset-generation/rigging-walkers/).

The seeded config carries the `{part}` templates and the `rig.json` path, so `init`
seeds a `rig.json` pre-populated with the case's **required animation declarations**
alone — its `parts` and `joints` start **empty**, because a case declares none. No
part exists until the model creates one with `define-part` (which initializes that
part's log, preview, and geometry); a field op on an undefined part is rejected. The
model **builds the whole rig** — inventing the parts and joints the subject needs and
authoring each required animation — and may add further animations of its own; the
**required animations** are the game-facing contract a reviewer scores against.

## The `mesh.json` output contract

Each binary emits, **per part** (a static model is a single implicit part), a
**`mesh.json`** — the single source of the extracted geometry. It has the same shape
as the runtime's `PartMesh` (the output of `@test-cabinet/voxel-runtime`'s
`buildPartMesh`):

- **`positions`** — a flat array of float triples (`x, y, z` per vertex),
- **`normals`** — a flat array of float triples (one per vertex),
- **`colors`** — a flat array of triples, using the **same normalization the runtime
  `PartMesh` uses**, and
- **`indices`** — a flat array of triangle-vertex indices.

`mesh.json` is the single source of geometry for every consumer, and the Rust
mesher runs **once**: the [wgpu preview renderer](#preview-rendering-wgpu--mesa-lavapipe)
consumes it, the TypeScript [`@test-cabinet/voxel-runtime`](/components/voxel-runtime/overview/)
consumes it directly (**no re-meshing in TS**), and `scripts/voxel-to-gltf.mjs`
packs `mesh.json` + `rig.json` into
[**glTF**](/components/voxel-runtime/overview/#exporting-to-gltf) — one mesh per part,
baked animations, and the joint-interface sidecar — for game and WebGL consumption.
The cube binaries emit `mesh.json` in the same shape, so one glTF exporter and one
runtime serve every voxel-family type.
