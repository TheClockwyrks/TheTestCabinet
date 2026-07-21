# Lattice Inserter — drawing brief

You are drawing the **Lattice inserter**, a **sprite sheet** for **Lattice**, a
top-down factory simulation. The inserter is the machine that moves one item at a
time between two adjacent tiles: it takes hold of an item on the tile behind it,
**swings** for a fixed time, then releases it onto the tile in front. It is a
swing, not an instant teleport — the whole point of this sprite is to read as an
arm sweeping across from one tile to the next.

You draw the **machine only — never an item**. The renderer draws the carried
item into the sprite at run time, so the same arm has to work for any cargo. Your
job is the arm and the hand that holds things, plus the **space reserved for what
it is holding** (see *The item slot*, which is the part of this brief most likely
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
  pendulum. Screen-down is *south on the floor*, not *toward the viewer's feet*.
- **No faux 3D.** No beveled sides falling away to the floor, no cast shadow
  under the arm implying it floats above the belt. The inserter is a flat shape
  on the floor.
- **Consistent with the rest of the factory.** Same flat 2D treatment, same
  grey-blue and amber color families, same crisp industrial read as the
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
  has **12 frames, numbered 0–11**.

## The machine

The inserter reads, at a glance, as a **swing-arm machine**:

- **Base / mount:** a small, **fixed** grey-blue pivot block sitting on the floor
  at the **centre of the frame**. It is the pivot the arm rotates from, and it is
  **identical in every frame** — it never moves, only the arm does.
- **Arm:** a slender **amber** arm reaching from the centre pivot out to the hand.
  It is the part that swings — draw it at the angle each frame calls for. Keep it
  readable as one limb rather than a blob.
- **Hand:** an **amber** gripper at the arm's tip — the part that takes hold of an
  item and lets go of it. Its design is **yours to choose**: pincers, a clamp, a
  cradle, a magnetic pad, a pair of arms that close around the item, anything that
  reads as a mechanism that grips. What it must do is make **holding** and **not
  holding** obvious at a glance (see *The swing*), and leave the item slot clear.

## The item slot

The renderer draws the carried item into this sprite. That only works if you
**leave room for it**, so this is a hard requirement rather than a nicety:

- The hand's **grip point** — the spot the item is centred on — sits at a
  **fixed distance from the pivot in every frame**, so the renderer can place an
  item from the swing angle alone. Do not let the arm's reach grow or shrink
  through the swing.
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

The sheet is **one swing cycle** — a single named sequence the viewer plays back
as a loop. Over the twelve frames the arm sweeps from the left pickup, in an arc
across the floor through the far side of the centre tile, to the right drop, then
back:

| Frames | Contents |
| --- | --- |
| 0 | hand over the **LEFT** pickup tile, **holding** |
| 1–4 | arm sweeping rightward, bowing through the **far (top) side** of the centre tile, still **holding** |
| 5 | hand over the **RIGHT** drop tile, still **holding** (about to release) |
| 6 | hand over the **RIGHT** drop tile, **released** (open and empty) |
| 7–10 | arm sweeping back leftward through the same arc, **empty** |
| 11 | hand over the **LEFT** pickup tile, **empty** — back at the start, so frame 11 loops to frame 0 |

So **frames 0–5 are the delivery stroke** (holding, left → right) and **frames
6–11 are the return stroke** (empty, right → left). Holding versus empty is the
single most important readable difference between the two halves, and it has to
be legible **from the hand itself**, outside the item slot — draw **no item**; the
renderer supplies the cargo.

Make the motion a **smooth arc across the floor**, seen from above: the hand is
over the left tile at the start, **bows outward through the far (top) edge** of
the centre tile at mid-swing, and reaches the right tile at the end — a curve
traced over the ground, **not** a straight horizontal slide and **not** a vertical
pendulum lift toward the top of the frame. Advance the arm by roughly the **same
angular step each frame** so the playback is even and the loop from frame 11 back
to frame 0 is seamless, with no jump or backward slip.

## Palette

Use only these colors:

| Role | Hex |
| --- | --- |
| Dark outline / shadow | `#1b1d21` |
| Base / mount — light | `#6a7884` |
| Base / mount — mid | `#4d5a64` |
| Base / mount — dark | `#36424b` |
| Arm + hand — amber | `#e6b329` |
| Arm + hand — highlight | `#f6d96b` |
| Arm + hand — shadow | `#b88410` |

The **arm and hand are amber** and the **base is grey-blue**. Keep the two color
families distinct — do not let the amber bleed into the base. There is **no held
item** in this sprite, so it uses no item colors at all.

## Working the tool

The `draw-sheet` binary is the only way to make a mark. You draw into the frame
you select with `--frame <index>`, using plain in-frame
coordinates (0–63). Run `draw-sheet --help` for the available operations (filling
and stroking circles and rectangles, lines, single pixels, flood fill, and a
horizontal mirror) and `draw-sheet <operation> --help` for each one's exact flags.
Call `draw-sheet` once per operation and read `frames/<index>.png` between calls to
judge that frame against this brief.
