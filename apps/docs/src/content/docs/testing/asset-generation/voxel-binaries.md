---
title: Voxel binaries
---

A [voxel](/testing/asset-generation/overview/#voxel-models-and-rigs)
asset-generation run sculpts through a **voxel binary** on its `PATH` — the only
channel for placing a voxel, the 3D counterpart of the
[drawing binaries](/testing/asset-generation/sprite-binaries/). There are two, both built
on the shared `model-core` library:

- **`voxel`** — for a [static model](/testing/asset-generation/manifests/#voxel-cases)
  (`asset_kind = "voxel-model"`): one opaque-RGB voxel volume, sculpted as a single
  model.
- **`voxel-anim`** — for a rigged, animated model (`asset_kind =
  "voxel-animation"`): the same operations plus a required `--part <name>` on every
  op, so **each part is a separate volume** with its own log and preview, and a set
  of **rig subcommands** that build the parts and joints hierarchy **and author the
  animations**.

The binaries are built from `crates/voxel` and `crates/voxel-anim` on the shared
`crates/model-core` library — the rig/animation model, the CLI record/preview
plumbing, the cube mesher, and the `wgpu` renderer — and each is baked into its own
[run-container image](/components/core/execution/#containerization): `voxel` into
the **voxel image** (`test-cabinet-voxel`) and `voxel-anim` into the
**voxel-animation image** (`test-cabinet-voxel-animation`), so a run carries only
the tool it uses. Nothing is regenerated or re-rendered after the run: the binary
**emits** the geometry (a per-part `.glb`) and the rig (`rig.json`), and the
validator parses those and confirms they are well-formed (see
[Evaluation](/testing/asset-generation/evaluation/)).

## Voxels are opaque and the volume starts empty

Every voxel cell is an **opaque `#rrggbb`** color — there is **no alpha**, so an
operation that touches a cell either sets it to a solid color or clears it back to
empty; nothing composites. The voxel volume always **starts empty**; the
`background` a case declares is only the preview PNG's clear color and
never places a voxel. Coordinates are the volume's integer grid: `x` across,
`y` **up**, `z` in depth, each in `0..extent`.

## The operations are ordinary CLI subcommands

A case seeds **no** operations schema. The vocabulary is the binary's own
`--help`, and the brief tells the model to read it:

```
voxel --help                 # every operation
voxel fill-box --help        # one operation's exact flags
```

Each operation is a subcommand with flags — there is no JSON. For example:

```
voxel set-voxel --x 16 --y 4 --z 16 --color "#c0c0c8"
voxel fill-box --x 6 --y 0 --z 10 --width 20 --height 4 --depth 12 --color "#3a4a5a"
voxel mirror --plane x --at 16
```

The operations are:

- **Placement:** `set-voxel`, `fill-box`, `line` (a 3D Bresenham run of voxels),
  and the convenience shapes `stroke-box` (a hollow box), `fill-sphere`,
  `fill-ellipsoid` (a sphere with unequal per-axis radii — domes, eggs, boulders),
  and `fill-cylinder` (a disc extruded along a chosen axis — barrels, legs, poles,
  wheels).
- **Clearing:** `clear-voxel`, `clear-box`.
- **Whole-volume edits:** `mirror` (reflect the volume across a plane, handy for a
  symmetric hull), `replace-color` (recolor every voxel of one color to another — a
  palette swap or shading pass), `translate` (shift every occupied voxel by a
  vector, clearing what it vacates), and `copy-box` (duplicate a source box's
  voxels to a destination offset — a second wheel, a repeated rivet).

Coordinates are **signed** (a shape may be placed partially outside the volume; the
out-of-bounds portion is **clipped**, never a panic); sizes and radii are unsigned.
Colors are opaque `#rrggbb`. A set/fill operation **replaces** the cells it touches,
so the recorded log produces an exact, order-only volume.

## How a call records; rendering is on request

Each operation **only appends itself to the run's operation log** — that is all a
sculpting call does. Unlike the 2D [drawing binaries](/testing/asset-generation/sprite-binaries/),
the voxel tools do **not** re-render after every call: meshing a volume and
rasterizing it through the `wgpu`+Mesa renderer is far more expensive than stamping
2D pixels, and a voxel model takes many operations, so rendering is a separate,
**on-request** step. The orchestrator seeds a `voxel.config.json` (static) or
`voxel-anim.config.json` (animated) next to the workspace giving the volume
dimensions, background, and the log/preview/geometry paths — and, for the animated
tool, the `rig.json` path — so neither an operation nor `render` needs any volume
flags.

The **`render` command** regenerates the derived artifacts from the recorded log
when the model asks for them: it meshes the model into its per-part `.glb` — the
surface as a standard glTF 2.0 binary, decoded into the runtime's `PartMesh` shape —
and draws the **preview** PNG from that geometry. A model runs it to read its
progress between edits and, **before it finishes, to emit the geometry the run's
result is built from** — an unrendered model leaves no `.glb`, which the validator
records as an empty part (see [Evaluation](/testing/asset-generation/evaluation/)).

```
voxel init            # write an empty log (a run starts pre-seeded); renders nothing
voxel render          # mesh the model to its .glb and draw the preview PNG
voxel render --view front   # ...from a chosen camera: iso (default) | front | side | top
voxel render --out check.png   # ...to an explicit path (the .glb still goes to its configured path)
```

### The preview

The preview `render` draws is a real **3D render of the meshed model**. The binary
meshes the voxel volume into geometry and renders it with **`wgpu` targeting Mesa
lavapipe** — software Vulkan, running on the CPU, headless (there is no GPU in the
run container) — through an **orbit camera** with directional shading, encoded as a
PNG. This generic mesh renderer lives in `model-core` and serves every voxel-family
binary, so previews are apples-to-apples across tools. It **replaces** the retired
integer-only isometric rasterizer (`crates/voxel/src/raster.rs`); the preview no
longer needs to be byte-reproducible, because nothing regenerates it after the run
(see [Evaluation](/testing/asset-generation/evaluation/)). The preview is a **still**
image; the interactive, rotatable 3D view is the frontend's three.js rendering of the
emitted per-part `.glb` (see [voxel-runtime](/components/voxel-runtime/overview/)),
not something the binary produces.

## Live preview

When a run is being **watched** — driven by a [driver](/components/driver/overview/)
or the [Tauri app](/components/tauri/overview/) rather than a plain `tcab run` —
the model's sculpting can be streamed to the viewer in real time, exactly as for
the [drawing binaries](/testing/asset-generation/sprite-binaries/#live-preview): the
orchestrator adds a `live` block to the seeded config, and **when the model runs
`render`** the binary connects back to the run host and streams a one-line JSON header
(`{ token, frame, operationCount, operation, length, meshLength }`) followed by the
freshly rendered preview PNG's raw bytes and then the part's current `.glb` bytes
(`meshLength` bytes) — the same glTF geometry the 3D client renders. (Because a
sculpting operation renders nothing, frames flow only when the model renders; a scene
render streams one per part.) The mesh body
lets the viewer rebuild the model **in 3D** as it is sculpted — rotating it and
assembling the scene exactly as the finished-run view does — rather than showing only
the still preview PNG; a PNG-only viewer simply ignores it. For an animated model the
`frame` field carries
the **part index**, so the viewer can show the most-recently-sculpted part, the
status of every part, and the assembled scene at once (a static model uses part
index `0`). Streaming is **best-effort and non-essential** — absent for an unwatched
run, never fails an operation, and never recorded; the recorded **operation log**
documents how the model built each part, and the reviewed artifacts are the geometry
and preview the binary [emits](/testing/asset-generation/evaluation/).

## `voxel-anim`: one volume per part, plus the rig

An animated model is a [rig](/testing/asset-generation/overview/#the-rig-parts-and-joints):
named parts in a hierarchy with named joints. `voxel-anim` is `voxel` plus a
required `--part <name>` that selects which part an operation sculpts into; that
part has its own operation log and its own preview, both `{part}` templates the
case declares (for example `parts/{part}.actions.json` and `parts/{part}.png`).
Every part is sculpted in the **same shared volume's coordinates** — the full
`[voxel]` dims — **in place** where the part sits on the assembled model (a turret
already up on top of the hull, a barrel already out front), not in a private
per-part box. A part's **pivot** is the anchor its joints rotate about, not a
placement offset: the [voxel-runtime](/components/voxel-runtime/overview/) poses a
part by rotating it about that pivot, and at rest a part stays exactly where it was
sculpted. (Sculpting each part in place is what lets the parts be composed into the
assembled model with no per-part offset — see the assembled scene below.)

```
voxel-anim --help                                       # same operations, plus --part
voxel-anim fill-box --part turret --x 12 --y 8 --z 12 --width 8 --height 4 --depth 8 --color "#4a5a3a"
voxel-anim init                                          # seed rig.json (the required animation declarations)
voxel-anim render                                        # mesh every part's .glb + draw the assembled scene
voxel-anim render --component turret                     # ...or just one part's preview + .glb
voxel-anim render --time 600 --animation walk            # ...or the model posed at 600ms of the walk
```

The seeded `voxel-anim.config.json` carries the `{part}` templates and the
`rig.json` path, so `voxel-anim init` seeds a `rig.json` pre-populated with the
case's **required animation declarations** (empty tracks; its `parts` and `joints`
start **empty**, because a case declares none). No part exists until the model
creates one with `define-part` — which then initializes that part's operation log —
so `init` renders nothing and seeds no per-part previews. The **per-part emitted data
and previews are the scored artifacts**; the assembled scene below is a non-scored
extra.

### The `render` command

Like `voxel`, `voxel-anim` renders **only on request** — a sculpting operation just
records. Its `render` has three modes:

- **`render`** (no options) — render the whole **assembled scene**: it re-emits
  **every** part's `.glb` and preview from its log (so one call produces all the
  geometry the run's result reads and refreshes every scored per-part image), then
  composes the parts at rest and writes one PNG per view to the config's `scene`
  template (default `scene/{view}.png`). This is the call to run before finishing.
- **`render --component <part>`** — render just that part: its own preview PNG and
  `.glb`, at a chosen `--view`. Cheap for iterating on one part.
- **`render --time <ms> [--animation <name>]`** — render the model **posed** at that
  instant of an animation, so you can check how the motion reads (a leg mid-stride, a
  barrel at full elevation). Each part's rest mesh is transformed by its animated
  world transform, exactly as the client poses it. `--animation` defaults to the sole
  or auto-play animation; the posed image goes to `scene/pose.png` (override with
  `--out`) and does not touch the parts' `.glb`s.

The assembled scene is what catches assembly mistakes a per-part preview can't: a
turret that reads fine alone but sits off-center on the hull, or a barrel that misses
the turret front. Its views are:

- **`iso`** — a 3D orbit render matching the per-part previews, for a read of the
  whole model.
- **`front`**, **`side`**, **`top`** — orthographic-camera elevations of the meshed
  model down each axis, so it is easy to check a part is centered and aligned
  head-on.

The plain scene composes parts at **rest** (every joint rests at `0`, so this is the
true rest pose); use `--time` to see joint motion. Neither the per-part previews nor
the scene is a scored artifact.

### Rig subcommands

Beyond sculpting voxels, `voxel-anim` edits the **rig structure** in `rig.json`:
its parts, its joints, and its **animations**. The case pre-seeds **only** the
**required animation declarations** (each just a name plus its loop/auto-play intent
— no parts, no joints, no keyframes) from its `[model]` table; the seeded `rig.json`
starts with **empty** `parts` and `joints`. These subcommands are how the model
**builds the whole rig** — inventing the parts and joints the subject needs and
authoring each required animation's motion — plus **adding** any further animations
of its own (the produced `rig.json` carries everything the model builds):

```
voxel-anim define-part  --name skirt --parent chassis
voxel-anim set-pivot    --part turret --x 16 --y 9 --z 16
voxel-anim define-joint --name turret_yaw --part turret --kind rotation --axis y \
                        --pivot-x 16 --pivot-y 9 --pivot-z 16 --min=-3.14159 --max 3.14159 --rest 0 --drive caller
voxel-anim define-joint --name barrel_mount --part barrel --kind rotation --axis x \
                        --pivot-x 16 --pivot-y 10 --pivot-z 20 --min 0 --max 0 --rest 0 \
                        --orient-x 0.2 --offset-y 1   # a fixed compound attach: mount tilted + raised
voxel-anim define-animation --name walk --period-ms 1200 --loop true --auto-play false
voxel-anim add-keyframe --animation walk --joint hip_l --t-ms 0    --value 0.35 --interp bezier
voxel-anim add-keyframe --animation walk --joint hip_l --t-ms 600  --value=-0.35 --interp ease-in
voxel-anim add-keyframe --animation walk --joint hip_l --t-ms 1200 --value 0.35 --interp bezier
```

- **`define-part`** adds a part under a declared `--parent` (the first part defined
  is the root, with no parent) and **initializes that part's operation log** so it
  immediately becomes a `--part` target for sculpting (its preview and `.glb` are
  written later, by `render`). A field operation on a part that has **not** been
  `define-part`'d yet is
  rejected. Set its pivot with `set-pivot`. A part sculpted with **no voxels** is an
  **attach point** (a `muzzle`, an exhaust) — an empty named node a game reads as a
  socket for a projectile or effect.
- **`set-pivot`** sets an existing part's pivot — the point, in the shared volume's
  coordinates, its joints rotate about.
- **`define-joint`** adds a named degree of freedom on a part — its `--kind`
  (`rotation`/`translation`), `--axis`, `--pivot`, `--min`/`--max`/`--rest` range,
  and `--drive`. A **`caller`** joint is the **procedural interface** a consuming game
  drives per frame (a turret's yaw, a gun's pitch), exported so the game can drive it
  within its limits; an **`auto`** joint is driven only by the model's animations. A
  joint may also carry a **fixed compound mount** applied in addition to its driven
  motion: `--offset-x/y/z` (a fixed translation in voxels) and `--orient-x/y/z` (a
  fixed rotation in radians, applied as Euler X→Y→Z about the pivot). This is how a
  component is attached at a custom rotation **and** translation — a joint with an
  empty driven range (`--min 0 --max 0 --rest 0`) but a non-zero mount is a purely
  static attachment; a joint with both a range and a mount does both.
- **`define-animation`** creates or redefines a named animation: its `--period-ms`
  (one loop), `--loop` (loop vs. play once and hold), and `--auto-play` (whether it
  plays continuously by default — a decorative idle such as a sweeping radar — versus
  a named playable the game triggers, such as a walk or a recoil). Its tracks are
  added with `add-keyframe`.
- **`add-keyframe`** adds or replaces one keyframe on an animation's track for a
  `--joint` (the first keyframe for a joint creates that track): its `--t-ms`,
  `--value`, and `--interp` — the [F-curve](#f-curves) interpolation of the segment
  leaving this key (`constant` | `linear` | `bezier`, or an easing preset `ease-in` |
  `ease-out` | `ease-in-out`) — with optional `--out-handle <dt,dv>` and
  `--in-handle <dt,dv>` Bézier tangent handles (omitted, a `bezier` key uses auto
  tangents).

#### F-curves

An animation track is an **F-curve** — the graph-editor curve real 3D tools use — so
motion carries weight and snap instead of sliding linearly between poses. Each
keyframe's `--interp` sets how the curve **leaves** it:

- **`constant`** holds the value until the next key (a step),
- **`linear`** draws a straight line to it,
- **`bezier`** draws a smooth curve shaped by tangent **handles** — an out-handle on
  this key and an in-handle on the next, each a control point offset from its key as
  `<dt_ms,dvalue>`; the segment is the cubic Bézier through them (a `bezier` key with
  no handles uses smooth auto tangents).

The **easing presets** expand to standard handles so common shaping needs no
hand-computed tangents: **`ease-in`** starts slow and accelerates into the next key
(the "thump" of a foot-plant or a recoil kick), **`ease-out`** starts fast and
decelerates, **`ease-in-out`** eases both ends (a smooth, weighty motion). The
[voxel-runtime](/components/voxel-runtime/overview/) samples these curves when it
poses the rig, and the [glTF exporter](/components/voxel-runtime/overview/#exporting-to-gltf)
bakes them so the eased motion survives into a game engine. See
[Rigging and animating walkers](/testing/asset-generation/rigging-walkers/) for how
to choose curves for a walk cycle.

#### Rotation direction

The volume is **y-up** with **forward at +z** (a part points toward higher `z`).
For a **rotation** joint, the sign of a value follows this convention:

- **Pitch (`--axis x`)** — a **positive** value **elevates**: it lifts a
  forward-pointing (+z) part **up** toward +y, and a **negative** value depresses
  it **down**. So for a gun that points forward, `max` aims **high** and `min`
  aims **low** — e.g. a `barrel_pitch` with `min = -0.2` (barrel depressed) and
  `max = 0.8` (barrel lobbing high) raises the barrel as the value grows.
- **Yaw (`--axis y`)** and **roll (`--axis z`)** are right-handed rotations about
  their axis through the pivot.

Rotation happens about the joint's `--pivot`, so place the pivot at the hinge the
part should swing on (the shoulder, the turret ring, the barrel mount).

The case's **required animations** are the game-facing contract a reviewer scores
against: the model must author every one so it actually animates, but the parts and
joints that realize them are entirely its own to invent. The rig subcommands load,
mutate, and rewrite `rig.json` in place, so it stays the single description of the
produced rig, which the validator reconciles against the required
[`[model]`](/testing/asset-generation/manifests/#voxel-cases) animations and the
[voxel-runtime](/components/voxel-runtime/overview/) poses.
