# Lattice Splitter — drawing brief

You are drawing the **Lattice splitter**, a **sprite sheet** for the Lattice
factory simulation. The splitter is a top-down **belt balancer**: a **standalone
machine** you connect transport belts to. It has **two belt inputs on one side and
two belt outputs on the other**, and it evens out the flow of items between them —
pulling from the two inputs and distributing them equally across the two outputs.
The balancing happens inside the machine, **hidden under its housing**; from
above you see the belts feeding in and out at the edges and that closed housing in
the middle. To show the machine at work, a **balancer shuttle** rides a beam across
the intake and sweeps back and forth between the two lanes, and the housing's
**output end is drawn as an arrow** so it is obvious which way the splitter feeds.
Everything below describes that *device seen from above*.

The splitter is **not** a pair of belts. It is a distinct component that belts
**plug into** — think of a belt running up to the splitter's input mouth, and a
belt leaving from its output mouth. Draw the machine, not a length of belt.

## The frames

- Each frame is its own **32×64-pixel** image with a transparent background.
  Origin is the top-left of the frame; `x` increases to the right, `y` increases
  downward. Coordinates are **within the frame** (0–63 in `y`, 0–31 in `x`).
- The sheet has **8 frames, numbered 0–7**. They are one continuous animation of
  the same splitter; only the short belt surfaces at the inputs and outputs move.
- The frame is **32 wide × 64 tall = two stacked 32×32 tile cells**: a **top
  cell** at `y` 0–31 and a **bottom cell** at `y` 32–63. The splitter is one
  device occupying **both** cells.

## Orientation

Draw **one** orientation: the flow runs to the **right (East)**. Items enter from
the **left (West)** and leave to the **right (East)**; the two lanes sit side by
side across that flow (stacked vertically in the frame). The renderer rotates this
single orientation for splitters facing other directions — do not draw any other
facing.

## The layout — inputs, housing, outputs

Read the frame left to right as three bands across the flow. All three span the
full 32 px height (both tile cells):

- **Inputs (West, `x` ≈ 0–8):** two short **belt mouths**, one in the top cell and
  one in the bottom cell — a single transport belt connects to each. Each mouth is
  **exactly one belt wide** — one full 32 px tile cell across the flow — and is a
  short run of belt surface (dark belt metal, a single central row of amber chevrons
  pointing East, side rails) reaching the **left edge**, so a transport belt tile
  butts up to it **flush, edge to edge**, neither wider nor narrower.
- **Housing (centre, `x` ≈ 8–24):** a solid **grey-blue metal housing** that
  spans the full height and **covers both cells**. This is the machine body: the
  balancing mechanism lives underneath and is **not visible**. The belt runs *under*
  the housing — items entering at the inputs disappear beneath it and reappear at
  the outputs. The housing is the **dominant mass** of the sprite and is what makes
  the device read as a machine rather than a belt. Its **West (intake) end carries a
  beam with a moving shuttle**, and its **East (output) end is shaped as an
  East-pointing arrow** — both detailed in *The form* below.
- **Outputs (East, `x` ≈ 24–32):** two short **belt mouths**, one in the top cell
  and one in the bottom cell, mirroring the inputs — a single transport belt
  connects to each, **exactly one belt wide** (one 32 px cell). Each reaches the
  **right edge** so an adjoining belt butts up **flush**, neither wider nor narrower.

So there are **two inputs and two outputs**, each **exactly one belt wide** (one
32 px cell), with the sealed balancing machine between them. The two inputs
together are **two belts wide** (the full 64 px) — which is why the splitter spans
two tiles.

## What goes in each frame

Every frame shows the **same splitter** in the **same place**. What changes frame
to frame is only the **belt surface at the four mouths** (the input and output
stubs):

- Each belt mouth carries a **single central row** of **amber chevrons pointing
  East** (right), centred in its 32 px cell exactly like a Lattice transport belt's
  surface — so a belt and the splitter's mouths visibly carry the same items in the
  same style. The frame shows two such rows, one per mouth, because the two inputs
  are **two separate belts** (unlike a single belt's one central row).
- Across the 8 frames the chevron pattern **scrolls East by a fixed step each
  frame** — advance it **2 px per frame** with a **16 px chevron pitch**, so 8 × 2 =
  16 px is exactly one pitch and **frame 7 hands back to frame 0 with no jump** (a
  seamless loop). A chevron sliding East off an input stub passes **under the
  housing**; a chevron emerges from under the housing onto each output stub. Make
  the mouths wrap at the left/right edges so they also tile horizontally with the
  adjoining belts.
- The **balancer shuttle** on the intake beam **slides back and forth across the
  two lanes** as the frames play: at frame 0 it sits at the **top** lane, slides
  down toward the **bottom** lane by the middle of the sequence, and returns to the
  top by the wrap, so **frame 7 hands back to frame 0 with no jump**. Give it a
  distinct position each frame so the sweep reads as one continuous back-and-forth,
  not a jitter between two spots.
- The **housing shell, the beam, the output arrow, and the divider are static** —
  they sit in the same place in every frame. The only moving things are the **belt
  chevrons at the mouths** (scrolling East) and the **shuttle** (sweeping along the
  beam).

So playing frames 0 → 7 reads as belts running into the machine while a balancer
sweeps back and forth across them, feeding the arrow-marked outputs.

## The form

The splitter reads, at a glance, as **one two-tile machine that belts plug into** —
a solid housed body flanked by belt mouths — **not** as two lengths of belt:

- **Housing (static, the machine body):** the central band is a raised
  grey-blue plate covering both cells. Give it depth — a lighter bevel along its
  top/left edges and the dark tone along its bottom/right — and a few machine
  details: **bolts at the corners** and a faint **inspection seam** across the top.
  Keep it a closed lid: the mechanism underneath is hidden, so no chevrons or lanes
  show through the housing. Its West end carries the beam and its East end is the
  output arrow (both below), so the housing's own silhouette is not a plain box.
- **Balancer beam and shuttle (the moving mechanism):** right where the housing
  starts on the intake side — a **vertical beam** spanning the full height at around
  `x` 8–10 — rides a small **shuttle** that slides **up and down the beam, across the
  two lanes**. The beam is a **static track** (the housing-dark tone, recessed with a
  dark outline) sitting on top of the closed housing; the shuttle is a compact block
  in the housing-light tone with an **amber** accent (the same amber as the movers)
  so the moving part reads clearly against the housing. The shuttle is the visible
  sign of the hidden balancing: it sweeps between the top and bottom inputs to even
  them out. (Its per-frame motion is described above.)
- **Output arrow (static, the direction marker):** the **East end of the housing** —
  the edge facing the outputs, around `x` 22–24 — is **not a flat vertical line** but
  a bold **arrowhead / chevron pointing East**, so the housing's silhouette itself
  points toward the outputs. Because a splitter only balances and otherwise looks the
  same feeding either way, this arrow is what makes the **output direction
  unmistakable** at a glance when the device stands alone. Draw it in the housing
  tones with the dark outline, optionally tipped with a thin amber edge; it stays put
  in every frame.
- **Belt mouths (moving):** the input and output stubs are short runs of transport
  belt — dark belt metal, side rails along the flow, and a single central row of
  scrolling amber chevrons. Each is **exactly one belt wide** (one 32 px cell),
  aligned to its tile cell so a single belt connects to it flush.
- **Lane divider (static):** on the belt mouths, a **seam running along the flow**
  (East–West) between the top and bottom cells, around `y` 31–32, so each input and
  each output reads as its **own single-belt lane**. Under the housing the lanes are
  hidden — the divider need not continue across the closed lid.
- **Amber accent:** keep the amber touches small and reserved for the **moving
  parts** — the shuttle, and optionally a thin amber edge on the output arrow — the
  way factory machines flag what moves. A short touch, not the whole frame.

Keep the moving amber chevrons reading clearly over the dark belt metal at each
mouth in every frame; the housing shell, beam, output arrow, and divider sit as
static structure while the shuttle and the mouth chevrons are the moving parts.

## Palette

Use only these colors:

| Role | Hex |
| --- | --- |
| Dark outline / shadow | `#1b1d21` |
| Belt metal — base | `#34383d` |
| Belt metal — mid | `#4a4f55` |
| Belt rail / edge highlight | `#6b7178` |
| Chevron (amber) — base | `#e6b329` |
| Chevron (amber) — highlight | `#f6d96b` |
| Chevron (amber) — shadow | `#b88410` |
| Housing (grey-blue) — light | `#6a7884` |
| Housing (grey-blue) — mid | `#4d5a64` |
| Housing (grey-blue) — dark | `#36424b` |

The **beam** uses the housing-dark `#36424b` (a recessed track, dark-outlined) and
the **shuttle** the housing-light `#6a7884` with an amber `#e6b329` accent against
the dark outline `#1b1d21`; the **output arrow** uses the housing tones with the
dark outline. Do not introduce any other color.

## Working the tool

The `draw-sheet` binary is the only way to make a mark. Draw into the frame you
select with `--frame <index>`, using plain in-frame coordinates. Run `draw-sheet
--help` for the available operations (filling and stroking circles and rectangles,
lines, single pixels, flood fill, and a horizontal mirror) and `draw-sheet
<operation> --help` for each one's exact flags. Call `draw-sheet` once per
operation and read `frames/<index>.png` between calls to judge that frame against
this brief.
