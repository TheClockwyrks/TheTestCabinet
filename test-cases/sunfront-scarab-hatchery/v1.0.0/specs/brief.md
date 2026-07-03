# Sunfront Scarab Hatchery — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Scarab Hatchery**, a squat, wide
hive-mound clustered with hatch cells, as a **3D voxel model** with a small
**rig** that animates on its own at runtime. There is no target model to copy:
build something that reads unmistakably as this hive-mound building and satisfies
the animation contract below.

This brief fixes **what the hatchery is** and **how it must move**. It
deliberately does **not** give you a parts list, joint placements, or pose angles
— **working out the pieces a living hive-mound needs, where they attach, and how
they articulate is the test.** Invent the rig.

## How the tool works

`voxel-anim` paints **discrete opaque cells** into a voxel volume. You build each
part by placing and clearing cells:

- **Place** cells with `set-voxel`/`fill-box`/`stroke-box`/`line`/`add-sphere`
  (each an opaque `#rrggbb` color); **clear** them with the matching clear/erase
  ops. `mirror` reflects the field across a plane.
- Global **`--part <name>`** selects the part an op sculpts; **each part is
  sculpted separately** in its own preview and log. Create a part with
  `define-part` before you sculpt into it.

Build **one operation at a time**. `voxel-anim` re-renders `parts/<part>.png` and
the assembled `scene/*.png` — **read them between calls**. `voxel-anim --help` is
the contract.

## The volume and coordinate system

- The volume is **56 wide (x) x 40 tall (y) x 56 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the mound, `0`-`55`. **y** runs up, `0` (bottom, the ground)
  to `39` (top). **z** runs front-to-back, `0`-`55`.
- **Forward is +z:** the front face of the mound is toward `z = 55`. Up is +y.
- Build the mound **symmetric about the lengthwise vertical centerplane between
  `x = 27` and `x = 28`**.
- The hatchery is deliberately **squat and wide** — a low, broad hive-mound that
  hugs the ground, not a tall tower. It fills most of the length and width and
  rises only partway up the volume.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  building.

## What the Hatchery is (and what is yours to invent)

Fixed — the building must read unmistakably as **all** of these:

- A **squat, wide domed hive-mound** of **brass-and-sandstone masonry** — a low,
  broad stronghold that hugs the ground, **not a plain box** and not a tall tower.
- **Hatch cells** clustered across its surface — recessed cells with a
  **solar-amber** glow (solar-hot at the brightest points) — so it reads as a
  living hive.
- A **central iris hatch** crowning the mound that **turns on its own** (see the
  animations).
- A **side exhaust vent** set into the mound's side that **bobs on its own**.
- A clear **solar-amber** energy accent and the palette below.

**Everything else is yours to invent** — the exact silhouette and proportions, how
the mound is domed and tiered, how the hatch cells are arranged, how the iris hatch
and vent are shaped, and how you break the building into rig parts and place its
joints. Nothing here prescribes a shape; the test rewards a bold, characterful
design that is unmistakably the Hatchery and animates convincingly.

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Masonry — primary plating (brass) | `#c69a4b` |
| Masonry — dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels / lighter structure (sandstone) | `#d9c48c` |
| Mechanisms, hatch ring, vent louvers (iron) | `#565c64` |
| Energy accent (solar amber) | `#ff9d2e` |
| Glowing core highlight (solar hot) | `#ffd76b` |

The **solar-amber** accent is the team-tint region: give the hatchery a clear
amber glow in the **hatch cells** clustered across the mound (with solar-hot at
the brightest points), so the accent reads from multiple angles.

## The required animations — the fixed contract

`rig.json` is pre-seeded with **two required animation declarations** by name (you
author the motion). Both are **self-playing decorative idles** (`auto_play`,
looping): the hatchery cycles continuously on its own with no caller. Author each
with `voxel-anim define-animation` then `add-keyframe`, choosing the period and
setting each key's `--interp` (`constant`/`linear`/`bezier` or the
`ease-in`/`ease-out`/`ease-in-out` presets, with optional
`--out-handle`/`--in-handle`) so the motion carries **weight** on smooth curves —
never a flat linear slide — and every loop is seamless (the end pose flows back
into the start).

- **`hatch_turn`** — the iris hatch's sweep. Turn the central hatch crowning the
  mound smoothly and continuously through a **full turn about its vertical axis**
  each cycle, like a slowly rotating iris. Ease the curve so it reads as a steady,
  weighted rotation rather than a constant linear spin. Design the hatch so it
  rotates plausibly about that vertical axis: no voxel should tear away from its
  mount or clip into the mound as it turns.
- **`vent_bob`** — the side vent's bob. **Lift the vent up** off its seat and
  **settle it back** each cycle. Shape the curve with weight — ease out of the
  seated rest, ease into the top of the rise, and `ease-in` into the settle so it
  lands softly rather than sliding at constant speed. Design the vent so it slides
  straight up and settles back without detaching from the mound.

You **may add** extra parts, joints, and auto-play animations of your own (subtle
steam plumes, extra detail hatch cells, and the like); you must produce these two
animations, by these names, and must not contradict them.

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>` in sensible
layers, set pivots with `set-pivot`, place joints with `define-joint`, and author
the two animations' keyframes — reading `parts/<part>.png` and the `scene/*.png`
previews between calls to confirm the parts fit, the hatch sits centered on the
crown, the vent seats into the side, and the animations read with weight. Run
`voxel-anim --help` for the available operations (setting and clearing single
voxels, filling and stroking boxes, 3D lines, spheres, and a mirror plane), the rig
subcommands, and the animation subcommands, and `voxel-anim <operation> --help` for
each one's exact flags. The recorded per-part logs and `rig.json` are your scored
submission.
