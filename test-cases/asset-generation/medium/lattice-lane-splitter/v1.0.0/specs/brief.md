# Lattice Lane Splitter — drawing brief

You are drawing the **Lattice lane splitter**, a **sprite sheet** for the Lattice
factory simulation. The lane splitter is a top-down **belt unzipper**: a
**standalone machine** you connect transport belts to. It has **two belt inputs on
one side and two belt outputs on the other**, and instead of evening the flow
between them it **pulls the two streams apart** — routing each incoming belt out to
the **outer lane** of its output, so the flow is split away from the centre toward
the two outer edges. The splitting happens inside the machine, **hidden under its
housing**; from above you see the belts feeding in and out at the edges and that
closed housing in the middle. To show the machine at work, the housing carries a
raised **splitting ridge down its centre** and **two moving spreader heads that ride
outward** toward the outer lanes, and its **output end is drawn as an arrow** so it
is obvious which way the lane splitter feeds. Everything below describes that
*device seen from above*.

The lane splitter is **not** a pair of belts. It is a distinct component that belts
**plug into** — think of a belt running up to the lane splitter's input mouth, and a
belt leaving from its output mouth. Draw the machine, not a length of belt.

## Layers — the belt is the base, the mechanism sits on top

The lane splitter is drawn in **two layers**, because in the simulation items ride
the belt **under** the machine's mechanism rather than being hidden by it:

- **The belt bed (the base).** Draw the transport-belt surface straight into each
  frame (with `--frame`, on no layer) as a **continuous belt bed** — the same dark
  belt metal, side rails, and scrolling amber chevrons as a Lattice transport belt,
  in both lanes, **unbroken from the West edge to the East edge, including the
  stretch beneath the mechanism**. This is the surface items travel on, so it must
  run continuously under the machine: an item entering an input slides along it and
  out an output without ever leaving the belt.
- **The mechanism (a separate layer).** Register a layer named **`mechanism`**
  (`draw-sheet register-layer --name mechanism`) and draw the machine's **housing
  shell, its East-pointing output arrow, its central splitting ridge, and its two
  moving spreader heads** onto that layer (`--layer mechanism`). The mechanism
  composites **on top of** the belt bed, so it hides the belt beneath it in the
  sprite — and, crucially, the renderer draws game items **between** the belt bed and
  this layer, so an item riding the belt passes **under** the mechanism (sliding
  beneath it and out the far side) rather than being faded out. That only works
  because the mechanism is a genuine separate layer with the belt whole underneath,
  not paint over a broken belt.

Everything the mechanism covers is therefore drawn twice — the belt bed underneath,
the mechanism on top — which is the whole point: the belt is continuous, and the
machine merely occludes it.

## The frames

- Each frame is its own **32×64-pixel** image with a transparent background.
  Origin is the top-left of the frame; `x` increases to the right, `y` increases
  downward. Coordinates are **within the frame** (0–63 in `y`, 0–31 in `x`).
- The sheet has **8 frames, numbered 0–7**. They are one continuous animation of
  the same lane splitter; the short belt surfaces at the inputs and outputs scroll
  and the two spreader heads move.
- The frame is **32 wide × 64 tall = two stacked 32×32 tile cells**: a **top
  cell** at `y` 0–31 and a **bottom cell** at `y` 32–63. The lane splitter is one
  device occupying **both** cells.

## Orientation

Draw **one** orientation: the flow runs to the **right (East)**. Items enter from
the **left (West)** and leave to the **right (East)**; the two lanes sit side by
side across that flow (stacked vertically in the frame). The renderer rotates this
single orientation for lane splitters facing other directions — do not draw any
other facing.

## The layout — inputs, housing, outputs

Read the frame left to right as three bands across the flow. All three span the
full 32 px height (both tile cells):

- **Inputs (West, `x` ≈ 0–8):** two short **belt mouths**, one in the top cell and
  one in the bottom cell — a single transport belt connects to each. Each mouth is
  **exactly one belt wide** — one full 32 px tile cell across the flow — and is a
  short run of belt surface (dark belt metal, a single central row of amber chevrons
  pointing East, side rails) reaching the **left edge**, so a transport belt tile
  butts up to it **flush, edge to edge**, neither wider nor narrower.
- **Housing (centre, `x` ≈ 8–24), on the `mechanism` layer:** a solid **grey-blue
  metal housing** that spans the full height and **covers both cells**. This is the
  machine body, drawn on the `mechanism` layer over the continuous belt bed (see
  *Layers*). The belt bed runs whole *underneath* it, so items ride that belt and
  pass **under** the housing, reappearing at the outputs — the housing occludes them,
  it does not sit on a gap in the belt. The housing is the **dominant mass** of the
  sprite and is what makes the device read as a machine rather than a belt. It
  carries a **central splitting ridge** and **two moving spreader heads that route
  the flow outward**, and its **East (output) end is shaped as an East-pointing
  arrow** — all detailed in *The form* below, all on the `mechanism` layer.
- **Outputs (East, `x` ≈ 24–32):** two short **belt mouths**, one in the top cell
  and one in the bottom cell, mirroring the inputs — a single transport belt
  connects to each, **exactly one belt wide** (one 32 px cell). Each reaches the
  **right edge** so an adjoining belt butts up **flush**, neither wider nor narrower.

So there are **two inputs and two outputs**, each **exactly one belt wide** (one
32 px cell), with the sealed unzipping machine between them. The two inputs
together are **two belts wide** (the full 64 px) — which is why the lane splitter
spans two tiles.

## What goes in each frame

Every frame shows the **same lane splitter** in the **same place**. What changes
frame to frame is the **scrolling belt bed** — the continuous base surface, which
runs the full width and is only *seen* at the four mouths because the `mechanism`
layer occludes its middle — and the mechanism's **two moving spreader heads**:

- Each belt mouth carries a **single central row** of **amber chevrons pointing
  East** (right), centred in its 32 px cell exactly like a Lattice transport belt's
  surface — so a belt and the lane splitter's mouths visibly carry the same items in
  the same style. The frame shows two such rows, one per mouth, because the two
  inputs are **two separate belts** (unlike a single belt's one central row). Keep
  the mouths' chevron rows the standard belt cross-section: the machine's job of
  moving items to the outer lanes is shown by the *mechanism*, not by shifting the
  belt surface off its centre line (that surface has to line up flush with a plain
  belt tile plugged in).
- Across the 8 frames the chevron pattern **scrolls East by a fixed step each
  frame** — advance it **2 px per frame** with a **16 px chevron pitch**, so 8 × 2 =
  16 px is exactly one pitch and **frame 7 hands back to frame 0 with no jump** (a
  seamless loop). A chevron sliding East off an input stub passes **under the
  housing**; a chevron emerges from under the housing onto each output stub. Make
  the mouths wrap at the left/right edges so they also tile horizontally with the
  adjoining belts.
- The **two spreader heads animate across the eight frames** to suggest the machine
  pulling the two streams apart and routing each out to its outer lane — and they
  must actually move, cycling smoothly so **frame 7 hands back to frame 0 with no
  jump**, at a distinct state each frame rather than jittering between two spots.
  How they move is detailed in *The form*; what matters is that a viewer reads them
  as the lane splitter **unzipping** the flow outward, not as static decoration.
- The **housing shell, the output arrow, and the central splitting ridge are
  static** — they sit in the same place in every frame. The only moving things are
  the **belt chevrons at the mouths** (scrolling East) and the **two spreader
  heads** (riding outward and back).

So playing frames 0 → 7 reads as belts running into the machine while it visibly
splits the two streams outward, feeding the arrow-marked outputs on their outer
lanes.

## The form

The lane splitter reads, at a glance, as **one two-tile machine that belts plug
into and that pulls the flow apart** — a solid housed body with a lengthwise
splitting ridge down its middle, flanked by belt mouths — **not** as two lengths of
belt and **not** as a symmetric side-to-side balancer:

- **Housing (static, the machine body):** the central band is a solid grey-blue
  plate covering both cells. Give its edges a little definition — a lighter tone
  along its top/left edges and the dark tone along its bottom/right — and a few
  machine details: **bolts at the corners** and a faint **inspection seam** across
  the top. Keep it a closed lid: the mechanism underneath is hidden, so no chevrons
  or lanes show through the housing. It carries the splitting ridge and the two
  spreader heads and its East end is the output arrow (all below), so the housing's
  own silhouette is not a plain box.
- **The splitting ridge (static, the defining feature):** a raised **spine / keel**
  running **along the flow (East–West) down the centre seam** of the housing — over
  the divider between the two lanes, roughly on the frame's horizontal centre line
  (`y` ≈ 30–33). Draw it with a lit top edge and a shadowed underside so it stands
  **proud of the lid**, like a wedge / blade that splits the flow between the top
  and bottom lanes. This central lengthwise ridge is the machine's signature: it is
  the closed lid over the point where the two streams part. It runs the length of
  the housing (optionally coming to a slight point at the intake, West end) and stays
  put in every frame.
- **The two spreader heads (the moving mechanism):** on top of the closed housing,
  **two** compact heads — one in the top lane, one in the bottom lane — that ride
  **outward from the central ridge toward the two outer edges** (the top head moves
  up toward the top edge, the bottom head moves down toward the bottom edge) and then
  draw back in, in **mirror symmetry** about the centre line. They are the visible
  sign of the machine routing each stream out to its outer lane — an **unzipping**
  motion, spreading apart and closing, never a single part sweeping side to side
  across the lanes. Draw them in the housing tones with an **amber** accent (the same
  amber as the belt movers) so they stand out against the housing, each optionally
  riding a short recessed **diverter rail** in the housing-dark tone that fans from
  the ridge out toward its outer output corner. (Their per-frame motion is described
  above: a smooth diverging cycle that loops seamlessly.)
- **Output arrow (static, the direction marker):** the **East end of the housing** —
  the edge facing the outputs, around `x` 22–24 — is **not a flat vertical line** but
  a bold **arrowhead / chevron pointing East**, so the housing's silhouette itself
  points toward the outputs. Because the machine otherwise looks similar feeding
  either way, this arrow is what makes the **output direction unmistakable** at a
  glance when the device stands alone. Draw it in the housing tones with the dark
  outline, optionally tipped with a thin amber edge; it stays put in every frame.
- **Belt mouths (moving):** the input and output stubs are short runs of transport
  belt — dark belt metal, side rails along the flow, and a single central row of
  scrolling amber chevrons. Each is **exactly one belt wide** (one 32 px cell),
  aligned to its tile cell so a single belt connects to it flush.
- **Lane divider (static):** on the belt mouths, a **seam running along the flow**
  (East–West) between the top and bottom cells, around `y` 31–32, so each input and
  each output reads as its **own single-belt lane**. Under the housing the divider is
  taken over by the splitting ridge, which sits directly over it.
- **Amber accent:** keep the amber touches small and reserved for the **moving
  parts** — the two spreader heads, and optionally a thin amber edge on the output
  arrow — the way factory machines flag what moves. A short touch, not the whole
  frame.

Keep the moving amber chevrons reading clearly over the dark belt metal at each
mouth in every frame; the housing shell, splitting ridge, output arrow, and divider
sit as static structure while the two spreader heads and the mouth chevrons are the
moving parts.

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

The **spreader heads** use the housing tones — housing-light `#6a7884` for their
body with an amber `#e6b329` accent against the dark outline `#1b1d21`, and
housing-dark `#36424b` for any recessed diverter rail they ride on; the **splitting
ridge** and **output arrow** use the housing tones with the dark outline (the ridge
lit along its top with housing-light and shadowed with housing-dark). Do not
introduce any other color.

## Working the tool

The `draw-sheet` binary is the only way to make a mark. Draw into the frame you
select with `--frame <index>`, using plain in-frame coordinates. Run `draw-sheet
--help` for the available operations (filling and stroking circles and rectangles,
lines, single pixels, flood fill, and a horizontal mirror) and `draw-sheet
<operation> --help` for each one's exact flags. Call `draw-sheet` once per
operation and read `frames/<index>.png` between calls to judge that frame against
this brief.
