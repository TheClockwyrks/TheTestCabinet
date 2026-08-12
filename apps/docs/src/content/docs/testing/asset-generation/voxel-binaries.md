---
title: Voxel binaries
---

A voxel asset-generation run sculpts through a voxel binary on its `PATH`. That
binary is the only channel for placing a voxel, the 3D counterpart of the
[drawing binaries](/testing/asset-generation/sprite-binaries/). There are two:

- `voxel` sculpts a static model (`asset_kind = "voxel-model"`): one opaque-RGB
  voxel volume.
- `voxel-anim` sculpts a rigged, animated model (`asset_kind =
  "voxel-animation"`). It adds a required `--part <name>` on every operation, so
  each part is a separate volume with its own log and preview, plus rig
  subcommands that build the parts-and-joints hierarchy and author the
  animations.

The binaries are built from `crates/voxel` and `crates/voxel-anim` on the shared
`crates/model-core` library, which holds the rig and animation model, the CLI
record plumbing, and the `wgpu` mesh renderer. Each is baked into its own
[run-container image](/components/core/execution/#containerization): `voxel`
into `test-cabinet-voxel` and `voxel-anim` into `test-cabinet-voxel-animation`,
so a run carries only the tool it uses.

The binary emits the reviewed artifacts. `render` writes the per-part `.glb`
geometry the 3D client loads and the preview PNG a reviewer sees. After the run
the validator replays the recorded log to count occupied voxels and reconciles
the produced `rig.json` against the case's required animations. It regenerates
neither the geometry nor the preview. See
[Evaluation](/testing/asset-generation/evaluation/).

## Voxels and the volume

Every voxel cell is an opaque `#rrggbb` color. An operation that touches a cell
either sets it to a solid color or clears it back to empty. The volume starts
empty, and the `background` a case declares is the preview PNG's clear color
alone. Coordinates are the volume's integer grid: `x` across, `y` up, `z` in
depth, each in `0..extent`.

## Sculpting operations

A case seeds no operations schema. The vocabulary is the binary's own `--help`,
and the brief tells the model to read it:

```
voxel --help                 # every operation
voxel fill-box --help        # one operation's exact flags
```

Each operation is a subcommand with flags:

```
voxel set-voxel --x 16 --y 4 --z 16 --color "#c0c0c8"
voxel fill-box --x 6 --y 0 --z 10 --width 20 --height 4 --depth 12 --color "#3a4a5a"
voxel mirror --plane x --at 16
```

The operations are:

- Placement: `set-voxel`, `fill-box`, `line` (a 3D Bresenham run of voxels),
  `stroke-box` (only a box's twelve edges, leaving its faces and interior
  empty), `fill-sphere`, `fill-ellipsoid` (a sphere with unequal per-axis radii,
  for domes, eggs, and boulders), and `fill-cylinder` (a disc extruded along a
  chosen axis, for barrels, legs, poles, and wheels).
- Clearing: `clear-voxel`, `clear-box`.
- Whole-volume edits: `mirror` reflects the low side of a plane onto the high
  side, which is the highest-leverage operation for a symmetric hull.
  `replace-color` recolors every voxel of one color to another, for a palette
  swap or a shading pass. `translate` shifts every occupied voxel by a vector
  and clears what it vacates. `copy-box` duplicates a source box's voxels to a
  destination offset, for a second wheel or a repeated rivet.

Coordinates are signed, so a shape may be placed partially outside the volume
and the out-of-bounds portion is clipped. Sizes and radii are unsigned. Colors
are opaque `#rrggbb`. A set or fill operation replaces the cells it touches, so
the recorded log produces an exact, order-only volume.

## Recording and on-request rendering

Each operation appends itself to the run's operation log, and that is all a
sculpting call does. Meshing a volume and rasterizing it through the software
renderer is far more expensive than stamping 2D pixels, and a voxel model takes
many operations, so rendering is a separate, on-request step.

The orchestrator seeds a `voxel.config.json` (static) or `voxel-anim.config.json`
(animated) next to the workspace giving the volume dimensions, background, and
the log, preview, and geometry paths, plus the `rig.json` path for the animated
tool. Neither an operation nor `render` needs volume flags.

`render` regenerates the derived artifacts from the recorded log. It meshes the
model into its per-part `.glb`, a standard glTF 2.0 binary decoded into the
runtime's `PartMesh` shape, and draws the preview PNG from that geometry. A
model runs it to read its progress between edits and, before finishing, to emit
the geometry the run's result is built from. An unrendered model leaves no
`.glb`, which the validator records as an empty part.

```
voxel init            # write an empty log (a run starts pre-seeded); renders nothing
voxel render          # mesh the model to its .glb and draw the preview PNG
voxel render --view front   # ...from a chosen camera: iso (default) | front | side | top
voxel render --out check.png   # ...to an explicit path (the .glb path is unchanged)
```

### The preview

The preview is a 3D render of the meshed model, 512 pixels square. The binary
meshes the voxel volume into geometry and renders it with `wgpu` targeting Mesa
lavapipe, a software Vulkan implementation running on the CPU with no GPU or
window in the run container, through an orbit camera with directional shading.
This renderer lives in `model-core` and serves every voxel-family binary, so
previews are comparable across tools.

The preview is a still image. The interactive, rotatable 3D view is the
frontend's three.js rendering of the emitted per-part `.glb`. See
[voxel-runtime](/components/voxel-runtime/overview/).

## Live preview

A run driven by a [driver](/components/driver/overview/) or the
[Tauri app](/components/tauri/overview/) is watched, and the model's sculpting is
streamed to the viewer in real time exactly as for the
[drawing binaries](/testing/asset-generation/sprite-binaries/#live-preview). The
orchestrator adds a `live` block to the seeded config. When the model runs
`render`, the binary connects back to the run host and streams a one-line JSON
header (`{ token, frame, operation, operationCount, length, meshLength,
rigLength }`) followed by the rendered preview PNG's raw bytes and then
`meshLength` bytes of the part's current `.glb`.

The mesh body lets the viewer rebuild the model in 3D as it is sculpted,
rotating it and assembling the scene as the finished-run view does. A PNG-only
viewer ignores it. Because a sculpting operation renders nothing, frames flow
only when the model renders, and a scene render streams one frame per part. For
an animated model the `frame` field carries the part index, so the viewer shows
the most-recently-sculpted part, the status of every part, and the assembled
scene at once. A static model uses part index `0`.

Streaming is best-effort. It is absent for an unwatched run, an operation
succeeds whether or not the listener responds, and the frames are never
recorded. The recorded operation log documents how the model built each part,
and the reviewed artifacts are the geometry and preview the binary emits.

## `voxel-anim`: one volume per part, plus the rig

An animated model is a [rig](/testing/asset-generation/overview/#the-rig): named
parts in a hierarchy with named joints. `voxel-anim` adds a required `--part
<name>` selecting which part an operation sculpts into. That part has its own
operation log and its own preview, both `{part}` templates the case declares,
for example `parts/{part}.actions.json` and `parts/{part}.png`.

Every part is sculpted in the same shared volume's coordinates, in place where
the part sits on the assembled model: a turret already up on top of the hull, a
barrel already out front. A part's pivot is the anchor its joints rotate about
rather than a placement offset. The
[voxel-runtime](/components/voxel-runtime/overview/) poses a part by rotating it
about that pivot, and at rest a part stays exactly where it was sculpted.
Sculpting in place is what lets the parts compose into the assembled model with
no per-part offset.

```
voxel-anim --help                              # same operations, plus --part
voxel-anim fill-box --part turret --x 12 --y 8 --z 12 \
                    --width 8 --height 4 --depth 8 --color "#4a5a3a"
voxel-anim render                              # every part's .glb + the assembled scene
voxel-anim render --component turret           # ...or just one part's preview + .glb
voxel-anim render --time 600 --animation walk  # ...or posed at 600ms of the walk
```

The orchestrator seeds `rig.json` pre-populated with the case's required
animation declarations, each carrying empty tracks. Its `parts` and `joints`
start empty, because a case declares none. No part exists until the model
creates one with `define-part`, which initializes that part's operation log.
`voxel-anim init` reinitializes the logs of whatever parts the rig already
carries and renders nothing. The per-part emitted geometry and previews are the
scored artifacts; the assembled scene is an extra.

### The `render` command

`voxel-anim` renders only on request. Its `render` has three modes:

- `render` with no options renders the whole assembled scene. It re-emits every
  part's `.glb` and preview from its log, so one call produces all the geometry
  the run's result reads and refreshes every scored per-part image, then composes
  the parts at rest and writes one PNG per view to the config's `scene` template
  (default `scene/{view}.png`). This is the call to run before finishing.
- `render --component <part>` renders just that part: its own preview PNG and
  `.glb`, at a chosen `--view`. This is the cheap path for iterating on one part.
- `render --time <ms> [--animation <name>]` renders the model posed at that
  instant of an animation, so the model can check how the motion reads. Each
  part's rest mesh is transformed by its animated world transform, exactly as the
  client poses it. `--animation` defaults to the sole or auto-play animation. The
  posed image goes to `scene/pose.png`, overridable with `--out`, and leaves the
  parts' `.glb`s untouched.

The assembled scene catches assembly mistakes a per-part preview cannot, such as
a turret that reads fine alone but sits off-center on the hull. Its views are:

- `iso`, a 3D orbit render matching the per-part previews, for a read of the
  whole model.
- `front`, `side`, and `top`, orthographic elevations of the meshed model down
  each axis, so it is easy to check that a part is centered and aligned head-on.

The plain scene composes parts at rest, with every joint at `0`. Use `--time` to
see joint motion.

### Rig subcommands

`voxel-anim` edits the rig structure in `rig.json`: its parts, its joints, and
its animations. The case pre-seeds only the required animation declarations,
each a name plus its loop and auto-play intent. These subcommands are how the
model builds the whole rig, inventing the parts and joints the subject needs,
authoring each required animation's motion, and adding any further animations of
its own. The produced `rig.json` carries everything the model builds.

```
voxel-anim define-part  --name skirt --parent chassis
voxel-anim set-pivot    --part turret --x 16 --y 9 --z 16
voxel-anim define-joint --name turret_yaw --part turret --kind rotation --axis y \
                        --pivot-x 16 --pivot-y 9 --pivot-z 16 \
                        --min=-3.14159 --max 3.14159 --rest 0 --drive caller
voxel-anim define-joint --name barrel_mount --part barrel --kind rotation --axis x \
                        --pivot-x 16 --pivot-y 10 --pivot-z 20 \
                        --min 0 --max 0 --rest 0 \
                        --orient-x 0.2 --offset-y 1   # a tilted, raised static mount
voxel-anim define-animation --name walk --period-ms 1200 --loop true --auto-play false
voxel-anim add-keyframe --animation walk --joint hip_l \
                        --t-ms 0 --value 0.35 --interp bezier
voxel-anim add-keyframe --animation walk --joint hip_l \
                        --t-ms 600 --value=-0.35 --interp ease-in
voxel-anim add-keyframe --animation walk --joint hip_l \
                        --t-ms 1200 --value 0.35 --interp bezier
```

`define-part` adds a part under a declared `--parent`, the first part defined
being the root, and initializes that part's operation log so it immediately
becomes a `--part` target. Its preview and `.glb` are written later, by `render`.
A sculpting operation on a part that has not been defined is rejected. A part
sculpted with no voxels is an attach point, an empty named node a game reads as
a socket for a projectile or an effect.

`set-pivot` sets an existing part's pivot: the point, in the shared volume's
coordinates, that its joints rotate about.

`define-joint` adds a named degree of freedom on a part, with its `--kind`
(`rotation` or `translation`), `--axis`, `--pivot`, `--min`/`--max`/`--rest`
range, and `--drive` (`caller` by default). A `caller` joint is the procedural
interface a consuming game drives per frame, such as a turret's yaw or a gun's
pitch, exported so the game can drive it within its limits. An `auto` joint is
driven only by the model's animations. A joint may also carry a fixed compound
mount applied in addition to its driven motion: `--offset-x/y/z` is a fixed
translation in voxels and `--orient-x/y/z` a fixed rotation in radians, applied
as Euler X→Y→Z about the pivot. A joint with an empty driven range and a
non-zero mount is a purely static attachment; a joint with both does both.

`define-animation` creates or redefines a named animation with its `--period-ms`
for one loop, `--loop` (loop versus play once and hold), and `--auto-play`
(playing continuously by default, such as a sweeping radar, versus a named
playable a game triggers). Redefining preserves already-authored tracks. Its
tracks are added with `add-keyframe`.

`add-keyframe` adds or replaces one keyframe on an animation's track for a
`--joint`, the first keyframe for a joint creating that track. It carries
`--t-ms`, `--value`, and `--interp`, the [F-curve](#f-curves) interpolation of
the segment leaving this key, with optional `--out-handle <dt,dv>` and
`--in-handle <dt,dv>` Bézier tangent handles.

#### F-curves

An animation track is an F-curve, the graph-editor curve real 3D tools use, so
motion carries weight and snap instead of sliding linearly between poses. Each
keyframe's `--interp` sets how the curve leaves it:

- `constant` holds the value until the next key.
- `linear` draws a straight line to it.
- `bezier` draws a smooth curve shaped by tangent handles: an out-handle on this
  key and an in-handle on the next, each a control point offset from its key as
  `<dt_ms,dvalue>`. The segment is the cubic Bézier through them. A `bezier` key
  with no handles uses smooth auto tangents.

The easing presets expand to standard handles, so common shaping needs no
hand-computed tangents. `ease-in` starts slow and accelerates into the next key,
which gives the thump of a foot-plant or a recoil kick. `ease-out` starts fast
and decelerates. `ease-in-out` eases both ends for a smooth, weighty motion.

The [voxel-runtime](/components/voxel-runtime/overview/) samples these curves
when it poses the rig, and the
[glTF exporter](/components/voxel-runtime/overview/#exporting-to-gltf) bakes them
so the eased motion survives into a game engine. See
[Rigging and animating walkers](/testing/asset-generation/rigging-walkers/) for
how to choose curves for a walk cycle.

#### Rotation direction

The volume is y-up with forward at +z, so a part points toward higher `z`. For a
rotation joint, the sign of a value follows this convention:

- Pitch (`--axis x`): a positive value elevates, lifting a forward-pointing part
  up toward +y, and a negative value depresses it. For a gun that points
  forward, `max` aims high and `min` aims low. A `barrel_pitch` with `min =
  -0.2` and `max = 0.8` raises the barrel as the value grows.
- Yaw (`--axis y`) and roll (`--axis z`) are right-handed rotations about their
  axis through the pivot.

Rotation happens about the joint's `--pivot`, so place the pivot at the hinge
the part should swing on: the shoulder, the turret ring, the barrel mount.

The case's required animations are the game-facing contract a reviewer scores
against. The model must author every one so it actually animates, and the parts
and joints that realize them are its own to invent. The rig subcommands load,
mutate, and rewrite `rig.json` in place, so it stays the single description of
the produced rig, which the validator reconciles against the required
[`[model]`](/testing/asset-generation/manifests/voxel-cases/) animations and the
[voxel-runtime](/components/voxel-runtime/overview/) poses.
