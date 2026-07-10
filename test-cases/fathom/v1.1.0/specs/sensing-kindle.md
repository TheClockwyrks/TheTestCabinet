# Fathom — Sensing: the vision circle, light, sonar, and brightness (signature)

This file defines how you perceive the dark trench: what is hidden, what your
light shows, what a sonar pulse reveals, and how eating makes you glow. These are
the signature systems of Fathom — read this file carefully. It builds on the tile
grid in `specs/overview.md` and the maze in `specs/playfield.md`, and it
cross-references the predators in `specs/predators.md`.

The dive is **Kindle**: you graze the plankton of one dark trench while the three
predators hunt you, descending to deeper, faster trenches as you clear each one
(see `specs/flow.md`), until your last life is lost. Its defining twist is that,
although you explore and remember the trench exactly as a fog of war, you only ever
**see** the part of your explored map that lies inside a **circular window you
carry** — a window that widens as you feed. The **mode label** shown in the HUD
(see `specs/playfield.md`) reads `KINDLE`.

## Fog of war and what is remembered

The trench starts entirely dark. Underneath, a tile is in one of three visibility
states at any moment, drawn differently in each (colors from `specs/overview.md`):

1. **Unrevealed** — never touched by light, sonar, or a flare. Drawn as flat fog
   (`#03060c`); you cannot tell wall from open water.
2. **Remembered** — revealed earlier but not currently lit. Drawn **dimly**: walls
   as dark rock, corridors as faint open water, and any plankton on them as faint
   motes.
3. **Lit** — revealed *right now* by your light, a live sonar mark, or a flare.
   Drawn at full brightness, with glows.

Draw the maze itself from the provided **trench tiles** (`assets/trench-walls/`,
see `specs/assets.md`): the wall autotile, floor, fog, and den-gate tiles. The
three visibility states are **runtime shading on those tiles**, not separate art.

**Fixed things are remembered for the whole trench; moving things are not — with
two amber exceptions.**

- **Walls and plankton:** once a tile is revealed by any source, it stays
  **remembered for the rest of the current trench** — including across losing a
  life. Descending to a new trench (see `specs/flow.md`) starts the fog over.
- **Predators:** **never remembered.** A predator's body is drawn only while
  currently **lit** — inside your live vision this instant, during the brief window
  after a sonar pulse or flare catches it (below), or during its detection alert
  (`specs/predators.md`). Between glimpses it is invisible, wherever it is.
- **The amber lights — shown only inside your vision circle (Kindle rule).** The
  **bonus drifters** and the **Lanternjaw's bulb-light** (`specs/playfield.md`,
  `specs/predators.md`) are the amber glimmers of the trench, drawn to look **almost
  identical** — a single glowing amber point in the dark — so you can never be sure,
  at a glance, which is a harmless drifter and which is a lurking Lanternjaw. Unlike
  the Trench dive, where they show at any distance, **Kindle draws them only inside
  your vision circle** (below): they are **not** painted across the blacked-out fog,
  so an amber mote out in the dark is invisible until it drifts into the window you
  carry — and even then you still cannot tell which is which without closing in. (They
  are still exempt from the fog *within* the circle: a drifter or bulb inside your
  window shows even where your light pocket does not reach. Only the Lanternjaw's
  *bulb* is shown at all; its body still obeys the fog like any predator.)

The memory is real: eaten plankton stay eaten, and a corridor you have explored is
still explored even when you cannot see it. What Kindle takes away is not the
*memory* but the *view* of it — the vision circle, next.

## The vision circle — a circular window you carry (signature)

Kindle adds one thing on top of the fog of war above, and it is what defines the
dive: an **outer vision circle** centered on the forager, beyond which the trench
is **not drawn at all**.

- **It is an actual circle, cut at the pixel.** A true circle of radius `R` around
  the forager's center. **Terrain and plankton are drawn only inside it**; every
  tile beyond it is painted as **pitch-black fog**, cut cleanly at the circle's
  edge — through the middle of tiles, not tile-by-tile.
- **It reveals nothing — it only limits what is shown.** The vision circle is a
  **rendering mask, not a sense**. It never reveals or remembers anything itself.
  What is drawn inside it is exactly what the fog of war has already revealed by
  another means (your light pocket, a sonar pulse, a flare): explored corridors and
  plankton show inside the circle at their remembered/lit brightness, while
  *never-revealed* ground inside the circle is still black. Ground you explored
  earlier that now lies **outside** the circle is **hidden** (pitch black) — but it
  is still **remembered**: return and it is drawn again, with any uneaten plankton
  still on it.
- **It grows as you eat and shrinks over time.** `R = 192 + 128 * G` px — from
  **`192 px` (6 tiles)** when you are dim out to **`320 px` (10 tiles)** at full
  glow, scaling with your brightness `G` (below). Eating swells the window so you
  see more of your explored surroundings at once; stop eating and it gutters back
  toward 6 tiles.
- **It is not vision for predators.** The vision circle governs only the **terrain
  and plankton** you see. **Predators** are governed by the smaller **light circle**
  (the line-of-sight light pocket below) and by sonar/flare marks — exactly as in
  any dive — so a predator is seen only where your light or a mark reaches it, never
  merely because it happens to be inside the vision circle.
- **What still shows beyond the circle.** Only the **enemy effects** are drawn **on
  top of** the blackout and so remain visible outside the vision circle: the
  **Flarefish's flare** (itself a second, full-vision circle — see Enemy effects
  below) and the **Gloamfin's ping ring** (`specs/predators.md`). The **amber lights**
  — the drifters and the Lanternjaw's bulb — do **not** show beyond the circle in
  Kindle (above); they are clipped to it. Everything else beyond the circle is pitch
  black.
- **Presentation.** Draw a soft glow filling the circle (the forager's color
  `#46f0e0`) and paint everything beyond `R` back to the flat fog (`#03060c`) with a
  clean circular edge. It is runtime light/mask you draw, not part of the art (see
  `specs/assets.md`).

So you carry a **circular window** onto the trench: you explore and remember exactly
as a fog of war, but you only ever *see* the part of your explored map within the
circle, and that window widens as you feed.

## Passive vision — the light circle travels straight

The forager emits a soft light, so a pocket of maze around it is always **lit**.
This is the smaller of the two circles — the **light circle** — and unlike the
vision circle it **does** reveal, and it is what shows predators.

- **Vision radius** `V` = **96 px** (3 tiles) at rest, growing with brightness up
  to **160 px** (5 tiles) — see Brightness below. (`V` is always smaller than the
  vision circle `R`.)
- **Line of sight (light travels straight).** A tile is lit by your passive light
  only if it is within `V` of the forager **and** the straight line from the
  forager's center to that tile is not blocked by a wall tile. Walls cast shadows:
  you **cannot see around a corner** with your own glow. A predator one tile away
  around a blind corner is not visible to your passive light.
- **Light reveals the walls it lands on, and stops there.** The rock that bounds a
  corridor your light reaches is **lit and revealed** too — a wall your light falls
  on is drawn as visible rock, never left as black fog — but the light does **not**
  pass beyond it: the tiles behind that wall stay dark.
- Predators and plankton inside this lit set are drawn live. (The bonus drifter and
  the Lanternjaw's bulb are drawn even outside it — they are always visible, above.)

## Brightness — eating makes you glow (risk dial)

Your brightness is a value `G` in `[0, 1]`, `0` when you have not eaten recently.

- **Eating raises it.** Each plankton eaten adds **`+0.34`** to `G` (clamped at
  `1`).
- **It holds, then decays — never a constant drain.** After you eat, `G` does
  **not** begin dropping immediately: it **holds steady for `1.0 s`** first, and
  only then starts to **decay**, losing half its remaining value every **`0.9 s`**
  (`G *= 0.5 ^ (dt / 0.9)`). The `1.0 s` hold **resets every time you eat a
  plankton**, so a forager grazing steadily (a pellet at least once a second) keeps
  its glow up, while a forager that stops eating holds for that second and then dims
  to near-dark within about another `2.5 s`. Brightness never bleeds away while you
  are actively eating.
- **It grows both circles.** Brightness widens the **light circle**
  `V = 96 + 64 * G` (**96 px** dim → **160 px** at full glow) and swells the
  **vision circle** `R = 192 + 128 * G` (**192 px** dim → **320 px** at full) — so
  eating both sharpens what reveals and predators you can see up close *and* widens
  the window onto your explored map. Each plankton's `+0.34` is worth about
  **`+22 px` (~0.7 tile)** on the light circle and **`+44 px` (~1.4 tiles)** on the
  vision circle, up to their caps.
- **It gives you away to the Lanternjaw.** The Lanternjaw senses your light from a
  range that grows with `G` (defined in `specs/predators.md`). Eating fast to clear
  corridors quickly lights you up like a beacon; eating sparingly keeps you dim and
  hard to find — but with a narrow window and a small light pocket. Managing this
  trade-off is core to the game.

## The sonar pulse — sound bends around corners

You can emit a **sonar pulse**: an active ability that reveals the maze ahead and
finds predators, at the cost of being heard. (The control is in
`specs/movement.md`.)

- **Cooldown.** A pulse is available on a **`1.75 s`** cooldown; the HUD shows a
  readiness gauge (see `specs/playfield.md`). The pulse recharges fairly quickly —
  its real cost is not the cooldown but that it is **heard** (it can hand the
  Gloamfin a fix), so you can afford to ping fairly often, just never carelessly near
  a Gloamfin.
- **Reveal (flood through corridors).** A pulse floods outward from the forager's
  tile **through open tiles only**, following the corridors like sound, out to a
  path range of **`E` = 9 tiles**. Every open tile within `E` corridor-steps becomes
  revealed (and **remembered**), **along with the wall tiles that bound those
  corridors**. Because it follows the corridors, the pulse **reveals around corners
  and bends through junctions** — unlike your straight-line light — but it does not
  pass through walls. (What the pulse reveals enters memory and shows through the
  vision circle: corridors it discovers beyond the circle are remembered, and you
  see them once they fall within the window.)
- **Find predators.** Any predator or the drifter standing on a tile in the flooded
  set is **marked**: shown at its position for **`1.5 s`** after the pulse, as a
  fading glimpse, even where your light does not reach.
- **You are heard.** Emitting a pulse makes noise: if it floods over the
  **Gloamfin** it hands the Gloamfin a **fix on you** and sets it chasing (see
  `specs/predators.md`). A pulse is never free — ping when you need to know, not
  constantly, and not when a Gloamfin is close.
- **Presentation.** Render an expanding ring from the forager to suggest the
  wavefront; the actual reveal is the flooded tile set, not a drawn circle. Use the
  provided **sonar-pulse** effect sheet (`assets/sonar-pulse/`, see
  `specs/assets.md`): it is drawn grayscale, so **tint it to the sonar-ring color**
  (`#5ef2ff`) and play its frames as the ring expands. The ring is a **large area
  effect** drawn as its own overlay, not part of any character, and it shows even
  beyond the vision circle. The Gloamfin emits the **same** sonar-pulse effect as
  its tell, tinted to its own color — but the Gloamfin's ping reveals nothing (see
  below and `specs/predators.md`).

## Enemy effects — what reveals the maze, and what does not

The two enemy effects that spread across the trench behave differently, and this
distinction matters:

- **The Flarefish's flare is a second vision circle.** At the bloom it lights a full
  **`192 px` (6-tile) radius** around the Flarefish — **floor and wall alike, and
  straight through walls** (the flare ignores rock) — revealing (and remembering)
  that whole disc, and showing any predator or the drifter inside it live. Unlike the
  window you carry, the flare's circle is **full vision: it reveals *everything*
  inside it**, drawn at **full brightness**, even ground you have never explored —
  so while it burns you see a second, bright disc of trench out beyond your own
  window, wherever the Flarefish is. This disc is drawn on top of your vision-circle
  mask, so a flare beyond your window still reads, and it is **stuck to the
  Flarefish**, moving with it. When the flare **fades, its circle disappears
  entirely** and only the window you carry remains: everything the flare had lit that
  lies outside your own vision circle goes **pitch black** again (it is still
  *remembered*, so it returns when you revisit it). It is a gift of vision
  (`specs/predators.md`).
- **The Gloamfin's ping reveals nothing.** Its violet sonar ring is **visible to
  you** — you see the ring spread across the trench, even beyond your vision circle —
  but it does **not** draw the Gloamfin itself, light the maze, reveal or remember
  any tile, or mark any other predator or a drifter. It is a warning you can see, not
  a map, and not even a fix on the hunter that cast it (`specs/predators.md`).

## How predators reveal themselves

You are never left fully blind to a predator: in addition to catching them in your
light or a sonar pulse, **each leaks a tell of its own** — the Lanternjaw's
always-visible amber **bulb**, the Gloamfin's own periodic **violet pings**, the
Flarefish's **flare bloom** (and, for the Gloamfin and Flarefish, the **detection
alert** that fires the instant they acquire you). Those tells, and exactly how each
predator senses and hunts you, are defined in `specs/predators.md`.
