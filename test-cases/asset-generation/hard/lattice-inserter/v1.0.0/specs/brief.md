# Lattice Inserter — drawing brief

You are drawing the **Lattice inserter**, a **sprite sheet** for **Lattice**, a
top-down factory simulation. The inserter is the machine that moves one item at a
time between two adjacent tiles: it takes hold of an item on the tile behind it,
**swings** for a fixed time, then releases it onto the tile in front. It is a
swing, not an instant teleport — the whole point of this sprite is to read as an
arm sweeping across from one tile to the next.

The inserter comes in **three tiers** — a base machine, a faster reinforced
machine, and the fastest, most advanced machine — and this one sheet carries all
three. Every tier is **the same inserter**, built from one construction language;
the tiers are upgrades of a single machine, not three different machines. A player
has to see at a glance that all three are the same inserter, only progressively
upgraded.

You draw the **machine only — never an item**. The renderer draws the carried
item into the sprite at run time, so the same arm has to work for any cargo. Your
job is the arm and the hand that holds things, plus the **space reserved for what
it is holding** (see _The item slot_, which is the part of this brief most likely
to be got wrong).

You draw **one canonical orientation**: the inserter is mounted on the centre
tile, it **picks up from the LEFT** (the tile behind it) and **drops to the
RIGHT** (the tile in front). The renderer rotates this sprite for the other
facings, so draw only this left-pickup / right-drop orientation.

## The style — flat, top-down 2D

Lattice is drawn **flat**. You are looking straight down at the factory floor,
and every sprite is a clean **2D shape on the grid**: crisp outlines, flat areas
of color, and shading used to tell one part from another rather than to fake a
third dimension.

- **You are looking down, not from the side.** The pivot base sits on the floor
  at the **centre of the frame**; the two tiles the inserter works are the **left
  half** (pickup) and the **right half** (drop), lying flat on the ground beside
  it. The arm sweeps **across the ground plane** between them. Do **not** draw a
  side elevation — the base does **not** sit on a ground line at the bottom of
  the frame, and the arm does **not** rise vertically "up the screen" like a
  pendulum. Screen-down is _south on the floor_, not _toward the viewer's feet_.
- **No faux 3D.** No beveled sides falling away to the floor, no cast shadow
  under the arm implying it floats above the belt. The inserter is a flat shape
  on the floor.
- **Consistent with the rest of the factory.** Same flat 2D treatment, same
  grey-blue and accent color families, same crisp industrial read as the
  assembler and the belts.

## The frames

- Each frame is its own **64×64-pixel** image with a transparent background.
  Origin is the top-left of the frame; `x` increases to the right, `y` increases
  downward. Coordinates are **within the frame** (0–63) — there is no shared sheet
  to offset into.
- The 64×64 box is a **2×2-tile span** (32 px per tile): the inserter's base sits
  on the **centre** of the box, and the arm reaches **left** toward the pickup
  tile and **right** toward the drop tile. The 64 px width exists so that reach
  fits — keep the whole arc inside the frame with a pixel or two of margin.
- You choose which frame an operation draws into with `--frame <index>`. The sheet
  has **36 frames, numbered 0–35**, in three tiers of twelve:

  | Frames    | Tier                        | Arm accent |
  | --------- | --------------------------- | ---------- |
  | `0`–`11`  | Tier 1 — base               | amber      |
  | `12`–`23` | Tier 2 — reinforced, faster | red-orange |
  | `24`–`35` | Tier 3 — advanced, fastest  | blue-cyan  |

- Each tier's twelve frames are one **swing cycle**.

## The three tiers

The three tiers are the **same inserter swinging faster**. What changes from one
tier to the next is exactly three things — the **arm accent color**, the **amount
of mechanical detail**, and the **swing speed** — and nothing else. The grey-blue
pivot base, the reach, the item slot, and the swing motion stay the same, so a
higher tier is unmistakably the same machine, only upgraded.

| Tier   | Arm accent | Mechanical detail                                                                            | Speed   |
| ------ | ---------- | -------------------------------------------------------------------------------------------- | ------- |
| Tier 1 | amber      | the base machine — a slender arm, a simple hand                                              | base    |
| Tier 2 | red-orange | reinforced — a secondary strut or rib along the arm, a bolt at the pivot, a sturdier gripper | faster  |
| Tier 3 | blue-cyan  | the most advanced — the densest arm and hand detail, a subtle energy glow along the arm      | fastest |

- **Arm accent color.** The **arm and hand** carry the tier's accent color — amber,
  then red-orange, then blue-cyan — using that tier's arm / highlight / shadow
  tones from the palette. The grey-blue **pivot base** is the **same tones in every
  tier**; only the arm and hand are recolored. A glance at the arm color alone
  tells the tiers apart.
- **Mechanical detail rises tier to tier.** Tier 1 is the plainest arm. Tier 2 adds
  reinforcement — a secondary strut or rib running along the arm, a bolt at the
  pivot, a sturdier gripper. Tier 3 is the densest and most refined: the finest arm
  and hand detailing plus a **subtle energy glow** (a thin bloom of pale cyan) along
  the arm. Each step adds richness without changing the reach, the pivot, or the
  item slot.
- **Higher tiers swing faster.** Each tier is drawn as its own twelve-frame swing
  cycle, built identically; the renderer plays a higher tier's cycle back at a
  higher rate, so the upgrade reads as a faster inserter. You do not change the
  per-frame drawing to convey speed — draw each tier's cycle the same way, and the
  playback does the rest.

The grip point stays at the **same fixed distance from the pivot in every tier**,
so the renderer can place an item from the swing angle alone regardless of tier.

## The machine

The inserter reads, at a glance, as a **swing-arm machine**:

- **Base / mount:** a small, **fixed** grey-blue pivot block sitting on the floor
  at the **centre of the frame**. It is the pivot the arm rotates from, and it is
  **identical in every frame of a tier** and the same grey-blue in every tier — it
  never moves, only the arm does.
- **Arm:** a slender arm in the tier's accent color reaching from the centre pivot
  out to the hand. It is the part that swings — draw it at the angle each frame
  calls for. Keep it readable as one limb rather than a blob.
- **Hand:** a gripper in the tier's accent color at the arm's tip — the part that
  takes hold of an item and lets go of it. Its design is **yours to choose**:
  pincers, a clamp, a cradle, a magnetic pad, a pair of arms that close around the
  item, anything that reads as a mechanism that grips. What it must do is make
  **holding** and **not holding** obvious at a glance (see _The swing_), and leave
  the item slot clear.

## The item slot

The renderer draws the carried item into this sprite. That only works if you
**leave room for it**, so this is a hard requirement rather than a nicety:

- The hand's **grip point** — the spot the item is centred on — sits at a
  **fixed distance from the pivot in every frame and every tier**, so the renderer
  can place an item from the swing angle alone. Do not let the arm's reach grow or
  shrink through the swing.
- Reserve a clear area roughly **16×16 px** (half a tile — the size a Lattice item
  is drawn at) centred on that grip point. The hand should **surround, cradle, or
  back** the item slot rather than cross it.
- **Nothing the sprite needs to communicate may live inside that slot.** On the
  delivery stroke an item is painted on top of it and will hide whatever is
  underneath. If the only thing that distinguishes "holding" from "empty" is drawn
  inside the slot, the sprite is broken — the item will cover the very thing it is
  supposed to confirm.
- Some overlap between the item and the hand is fine, and often reads well — a
  gripper whose fingers close over the edges of what it carries looks right. The
  rule is that any such overlap must be a **choice you made**, not an accident of
  where the item lands.

## The swing

Each tier's twelve frames are **one swing cycle** — a single named sequence the
viewer plays back as a loop. Over the twelve frames the arm sweeps from the left
pickup, in an arc across the floor through the far side of the centre tile, to the
right drop, then back. Reading the twelve as positions 1–12 within the tier's loop:

| Position in the loop | Contents                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| 1                    | hand over the **LEFT** pickup tile, **holding**                                                         |
| 2–5                  | arm sweeping rightward, bowing through the **far (top) side** of the centre tile, still **holding**     |
| 6                    | hand over the **RIGHT** drop tile, still **holding** (about to release)                                 |
| 7                    | hand over the **RIGHT** drop tile, **released** (open and empty)                                        |
| 8–11                 | arm sweeping back leftward through the same arc, **empty**                                              |
| 12                   | hand over the **LEFT** pickup tile, **empty** — back at the start, so the last frame loops to the first |

So the **first six frames of each tier's loop are the delivery stroke** (holding,
left → right) and the **last six are the return stroke** (empty, right → left).
Holding versus empty is the single most important readable difference between the
two halves, and it has to be legible **from the hand itself**, outside the item
slot — draw **no item**; the renderer supplies the cargo.

Make the motion a **smooth arc across the floor**, seen from above: the hand is
over the left tile at the start, **bows outward through the far (top) edge** of
the centre tile at mid-swing, and reaches the right tile at the end — a curve
traced over the ground, **not** a straight horizontal slide and **not** a vertical
pendulum lift toward the top of the frame. Advance the arm by roughly the **same
angular step each frame** so the playback is even and each tier's loop is seamless,
with no jump or backward slip. Every tier's cycle is built this same way; the tiers
differ only in the arm accent, the level of detail, and the rate the cycle plays
back at.

## Palette

Use only these colors. The grey-blue base is shared by every tier; each tier draws
its arm and hand in its own accent trio.

### Shared base — every tier

| Role                  | Hex       |
| --------------------- | --------- |
| Dark outline / shadow | `#1b1d21` |
| Base / mount — light  | `#6a7884` |
| Base / mount — mid    | `#4d5a64` |
| Base / mount — dark   | `#36424b` |

### Tier 1 arm — amber

| Role                 | Hex       |
| -------------------- | --------- |
| Arm + hand           | `#e6b329` |
| Arm + hand highlight | `#f6d96b` |
| Arm + hand shadow    | `#b88410` |

### Tier 2 arm — red-orange

| Role                 | Hex       |
| -------------------- | --------- |
| Arm + hand           | `#e6602a` |
| Arm + hand highlight | `#f59a5a` |
| Arm + hand shadow    | `#b8400f` |

### Tier 3 arm — blue-cyan

| Role                 | Hex       |
| -------------------- | --------- |
| Arm + hand           | `#2ab0e6` |
| Arm + hand highlight | `#7fd8f6` |
| Arm + hand shadow    | `#1069b8` |
| Energy glow          | `#bfeeff` |

The **arm and hand are the tier's accent color** and the **base is grey-blue**.
Keep the two color families distinct — do not let the arm color bleed into the
base. The tier-3 **energy glow** is a thin bloom of pale cyan used sparingly along
the arm; it appears in no other tier. There is **no held item** in this sprite, so
it uses no item colors at all.

## Working the tool

The `draw-sheet` binary is the only way to make a mark. You draw into the frame
you select with `--frame <index>`, using plain in-frame
coordinates (0–63). Run `draw-sheet --help` for the available operations (filling
and stroking circles and rectangles, lines, single pixels, flood fill, and a
horizontal mirror) and `draw-sheet <operation> --help` for each one's exact flags.
Call `draw-sheet` once per operation and read `frames/<index>.png` between calls to
judge that frame against this brief.
