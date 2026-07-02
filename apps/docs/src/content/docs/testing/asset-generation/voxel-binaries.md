---
title: Voxel binaries
---

A [voxel](/testing/asset-generation/overview/#voxel-models-and-rigs)
asset-generation run sculpts through a **voxel binary** on its `PATH` — the only
channel for placing a voxel, the 3D counterpart of the
[drawing binaries](/testing/asset-generation/binaries/). There are two, sharing
one voxel-and-raster implementation:

- **`voxel`** — for a [static model](/testing/asset-generation/manifests/#voxel-cases)
  (`asset_kind = "voxel-model"`): one opaque-RGB voxel volume, sculpted as a single
  model.
- **`voxel-anim`** — for a rigged, animated model (`asset_kind =
  "voxel-animation"`): the same operations plus a required `--part <name>` on every
  op, so **each part is a separate volume** with its own log and preview, and a set
  of **rig subcommands** that build the parts/joints hierarchy.

The binaries are built from `crates/voxel` and each is baked into its own
[run-container image](/components/core/execution/#containerization): `voxel` into
the **voxel image** (`test-cabinet-voxel`) and `voxel-anim` into the
**voxel-animation image** (`test-cabinet-voxel-animation`), so a run carries only
the tool it uses. The same library regenerates the voxels and the isometric
preview after the run (see [Evaluation](/testing/asset-generation/evaluation/)), so
a model produced any other way cannot match.

## Voxels are opaque and the volume starts empty

Every voxel cell is an **opaque `#rrggbb`** color — there is **no alpha**, so an
operation that touches a cell either sets it to a solid color or clears it back to
empty; nothing composites. The voxel volume always **starts empty**; the
`background` a case declares is only the isometric preview PNG's clear color and
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
so the recorded log regenerates to an exact, order-only volume.

## How a call records and previews

Each operation appends itself to the run's **operation log** and re-renders the
**preview** from the whole log, so the recorded log is always the single source of
truth and the preview always reflects it. The orchestrator seeds a
`voxel.config.json` (static) or `voxel-anim.config.json` (animated) next to the
workspace giving the volume dimensions, background, the log/preview paths — and,
for the animated tool, the part list and the `rig.json` path — so an operation
needs no volume flags. A model reads the preview between calls to judge its
progress.

```
voxel init    # write an empty log and a blank isometric preview (a run starts pre-seeded)
voxel render --actions <log> --out <png> --width <w> --height <h> --depth <d>   # regenerate a log
```

### The isometric preview

The preview each call re-renders is a **fixed isometric** projection rasterized by
an **integer-only painter's algorithm** — occupied voxels drawn back-to-front,
three visible cube faces each with a fixed shading multiplier, encoded with the
same PNG encoder the sprite tools use so the validator's decoder round-trips it.
The camera constants (the isometric basis, the cube edge in pixels, and the output
dimensions derived from the volume `[voxel]` dims) are fixed in the binary and
shared with the validator — this **one rasterizer serves both** the in-container
preview and the post-run regeneration, which is what makes
[cheat-divergence](/testing/asset-generation/evaluation/) meaningful: a model that
places voxels only through the tool regenerates to the same PNG, and a model that
writes an image directly diverges. The preview is a **still** image; the
interactive, rotatable 3D view is the frontend's three.js rendering of the
regenerated `voxels.json` (see [voxel-runtime](/components/voxel-runtime/overview/)),
not something the binary produces.

## Live preview

When a run is being **watched** — driven by a [driver](/components/driver/overview/)
or the [Tauri app](/components/tauri/overview/) rather than a plain `tcab run` —
the model's sculpting can be streamed to the viewer in real time, exactly as for
the [drawing binaries](/testing/asset-generation/binaries/#live-preview): the
orchestrator adds a `live` block to the seeded config, and after each operation the
binary connects back to the run host and streams a one-line JSON header
(`{ token, frame, operationCount, operation, length, voxelLength }`) followed by the
freshly rendered isometric PNG's raw bytes and then the part's current `voxels.json`
text (`voxelLength` bytes). The voxel body lets the viewer rebuild the model **in
3D** as it is sculpted — rotating it and assembling the scene exactly as the
finished-run view does — rather than showing only the flat isometric PNG; a
PNG-only viewer simply ignores it. For an animated model the `frame` field carries
the **part index**, so the viewer can show the most-recently-sculpted part, the
status of every part, and the assembled scene at once (a static model uses part
index `0`). Streaming is **best-effort and non-essential** — absent for an unwatched
run, never fails an operation, and never recorded; the recorded **operation log**
remains the run's authoritative output, and the reviewed voxels and preview are
always [regenerated](/testing/asset-generation/evaluation/) from it.

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
voxel-anim init                                          # initialize every declared part + rig.json
voxel-anim render --actions <log> --out <png> --width 32 --height 24 --depth 32
```

The seeded `voxel-anim.config.json` lists the declared part names and the `{part}`
templates, so `voxel-anim init` initializes every part's empty log and blank
preview and seeds a `rig.json` pre-populated with the case's **required** parts and
joints. The **per-part previews are the scored artifacts** (each deterministic);
the assembled scene below is a non-scored extra.

### The assembled scene

Because each part is sculpted in place in the shared coordinates, `voxel-anim` also
renders the whole model **composed at rest** — every part unioned in one volume —
after every operation (and on `init`), alongside the per-part previews. This is the
view that catches assembly mistakes a per-part preview can't: a turret that reads
fine alone but sits off-center on the hull, or a barrel that misses the turret
front. It is written to the config's `scene` template (default `scene/{view}.png`),
one PNG per view:

```
voxel-anim scene        # re-render the assembled scene on demand (also automatic after each op)
```

- **`iso`** — the same isometric projection as the per-part previews, for a 3D read
  of the whole model.
- **`front`**, **`side`**, **`top`** — flat orthographic elevations (one voxel is
  one filled square; the nearest voxel along the view axis wins), so it is easy to
  check a part is centered and aligned head-on.

The scene composes parts at **rest** (the required rig rests at `0`, so this is the
true rest pose); it does not apply joint motion — the interactive, posable view is
the frontend's [voxel-runtime](/components/voxel-runtime/overview/) rendering. Like
the per-part previews, the scene is **not** a scored artifact.

### Rig subcommands

Beyond sculpting voxels, `voxel-anim` edits the **rig structure** in `rig.json`.
The case pre-seeds the required parts and joints from its `[model]` table; these
subcommands let the model **add its own** parts, joints, and auto-play clips on top
(the produced `rig.json` carries the required set plus everything the model adds):

```
voxel-anim define-part  --name skirt --parent chassis
voxel-anim set-pivot    --part turret --x 16 --y 9 --z 16
voxel-anim define-joint --name recoil --part barrel --kind translation --axis z \
                        --pivot-x 16 --pivot-y 10 --pivot-z 20 --min=-2 --max 0 --rest 0 --drive auto
voxel-anim define-joint --name barrel_mount --part barrel --kind rotation --axis x \
                        --pivot-x 16 --pivot-y 10 --pivot-z 20 --min 0 --max 0 --rest 0 \
                        --orient-x 0.2 --offset-y 1   # a fixed compound attach: mount tilted + raised
voxel-anim define-clip  --joint recoil --period-ms 600 --loop false \
                        --keyframe 0:0 --keyframe 100:-2 --keyframe 600:0
```

- **`define-part`** adds a part under a declared `--parent`; it then becomes a
  `--part` target for sculpting. Set its pivot with `set-pivot`.
- **`set-pivot`** sets an existing part's pivot — the point, in the shared volume's
  coordinates, its joints rotate about.
- **`define-joint`** adds a named degree of freedom on a part — its `--kind`
  (`rotation`/`translation`), `--axis`, `--pivot`, `--min`/`--max`/`--rest` range,
  and `--drive` (`caller` for a game-supplied value, `auto` for a clip). A joint may
  also carry a **fixed compound mount** applied in addition to its driven motion:
  `--offset-x/y/z` (a fixed translation in voxels) and `--orient-x/y/z` (a fixed
  rotation in radians, applied as Euler X→Y→Z about the pivot). This is how a
  component is attached at a custom rotation **and** translation — a joint with an
  empty driven range (`--min 0 --max 0 --rest 0`) but a non-zero mount is a purely
  static attachment; a joint with both a range and a mount does both.
- **`define-clip`** attaches an auto-play timeline to a `--drive auto` joint: a set
  of `--keyframe <t_ms>:<value>` samples over a `--period-ms`, looping or holding.

A model **cannot** remove or contradict the case's required parts and joints — the
required interface is the game-facing contract a reviewer scores against. The rig
subcommands load, mutate, and rewrite `rig.json` in place, so it stays the single
description of the produced rig, which the validator reconciles against the
required [`[model]`](/testing/asset-generation/manifests/#voxel-cases) and the
[voxel-runtime](/components/voxel-runtime/overview/) poses.
