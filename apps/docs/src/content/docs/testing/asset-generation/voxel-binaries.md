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

The operations are: `set-voxel`, `fill-box`, `line` (a 3D Bresenham run of
voxels), `clear-voxel`, `clear-box`, `mirror` (reflect the volume across a plane,
handy for a symmetric hull), and the convenience shapes `stroke-box` (a hollow
box) and `fill-sphere`. Coordinates are **signed** (a shape may be placed
partially outside the volume; the out-of-bounds portion is **clipped**, never a
panic); sizes and radii are unsigned. Colors are opaque `#rrggbb`. A set/fill
operation **replaces** the cells it touches, so the recorded log regenerates to an
exact, order-only volume.

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
(`{ token, frame, operationCount, operation, length }`) followed by the freshly
rendered isometric PNG's raw bytes. For an animated model the `frame` field carries
the **part index**, so the viewer can show the most-recently-sculpted part and the
status of every part at once (a static model uses part index `0`). Streaming is
**best-effort and non-essential** — absent for an unwatched run, never fails an
operation, and never recorded; the recorded **operation log** remains the run's
authoritative output, and the reviewed voxels and preview are always
[regenerated](/testing/asset-generation/evaluation/) from it.

## `voxel-anim`: one volume per part, plus the rig

An animated model is a [rig](/testing/asset-generation/overview/#the-rig-parts-and-joints):
named parts in a hierarchy with named joints. `voxel-anim` is `voxel` plus a
required `--part <name>` that selects which part an operation sculpts into; that
part has its own operation log and its own preview, both `{part}` templates the
case declares (for example `parts/{part}.actions.json` and `parts/{part}.png`).
Coordinates are **within the part's local volume** — the part hierarchy's pivots,
not shared coordinates, place a part on its parent.

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
any assembled or posed preview is a non-scored extra.

### Rig subcommands

Beyond sculpting voxels, `voxel-anim` edits the **rig structure** in `rig.json`.
The case pre-seeds the required parts and joints from its `[model]` table; these
subcommands let the model **add its own** parts, joints, and auto-play clips on top
(the produced `rig.json` carries the required set plus everything the model adds):

```
voxel-anim define-part  --name skirt --parent chassis --pivot 16,2,16
voxel-anim set-pivot    --part turret --pivot 16,9,16
voxel-anim define-joint --name recoil --part barrel --kind translation --axis z \
                        --pivot 16,10,20 --min -2 --max 0 --rest 0 --drive auto
voxel-anim define-clip  --joint recoil --period-ms 600 --loop false \
                        --keyframe 0:0 --keyframe 100:-2 --keyframe 600:0
```

- **`define-part`** adds a part under a declared `--parent` at a `--pivot` (its
  attachment point in the parent's local voxel coordinates); it then becomes a
  `--part` target for sculpting.
- **`set-pivot`** moves an existing part's attachment pivot.
- **`define-joint`** adds a named degree of freedom on a part — its `--kind`
  (`rotation`/`translation`), `--axis`, `--pivot`, `--min`/`--max`/`--rest` range,
  and `--drive` (`caller` for a game-supplied value, `auto` for a clip).
- **`define-clip`** attaches an auto-play timeline to a `--drive auto` joint: a set
  of `--keyframe <t_ms>:<value>` samples over a `--period-ms`, looping or holding.

A model **cannot** remove or contradict the case's required parts and joints — the
required interface is the game-facing contract a reviewer scores against. The rig
subcommands load, mutate, and rewrite `rig.json` in place, so it stays the single
description of the produced rig, which the validator reconciles against the
required [`[model]`](/testing/asset-generation/manifests/#voxel-cases) and the
[voxel-runtime](/components/voxel-runtime/overview/) poses.
