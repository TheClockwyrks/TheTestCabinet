# Fathom — Sensing: fog of war, light, sonar, and brightness (signature)

This file defines how you perceive the dark trench: what is hidden, what your
light shows, what a sonar pulse reveals, and how eating makes you glow. These are
the signature systems of Fathom — read this file carefully. It builds on the tile
grid in `specs/overview.md` and the maze in `specs/playfield.md`, and it
cross-references the predators in `specs/predators.md`.

The dive is **Trench**: you graze the plankton of one dark trench while the three
predators hunt you, descending to deeper, faster trenches as you clear each one
(see `specs/flow.md`), until your last life is lost. The **mode label** shown in
the HUD (see `specs/playfield.md`) reads `TRENCH`.

## Fog of war and what is remembered

The trench starts entirely dark. A tile is in one of three visibility states at
any moment, and it is drawn differently in each (colors from
`specs/overview.md`):

1. **Unrevealed** — never touched by light, sonar, or a flare. Drawn as flat fog
   (`#03060c`); you cannot tell wall from open water.
2. **Remembered** — revealed earlier but not currently lit. Drawn **dimly**: walls
   as dark rock, corridors as faint open water, and any plankton on them as faint
   motes. You can see the *shape of the maze* you have explored, but not what is
   moving there now.
3. **Lit** — revealed *right now* by your light, a live sonar mark, or a flare.
   Drawn at full brightness, with glows.

Draw the maze itself from the provided **trench tiles** (`assets/trench-walls/`,
see `specs/assets.md`): the wall autotile, floor, fog, and den-gate tiles. The
three visibility states are **runtime shading on those tiles**, not separate
art — lit is the tile at full brightness, remembered is the same tile drawn dim,
and
unrevealed is the fog tile.

**The whole explored map stays drawn.** This is a StarCraft-style fog of war:
every tile you have ever revealed keeps being drawn — remembered ones dim, the
lit pocket around you bright — across the entire grid at once. There is **no
circle of visibility that blacks out explored ground**; only your immediate light
pocket is brighter, and only *never-revealed* tiles are black.

**Fixed things are remembered for the whole trench; moving things are not — with
two amber exceptions.**

- **Walls and plankton:** once a tile is revealed by any source, it stays
  **remembered for the rest of the current trench** — including across losing a
  life. Descending to a new trench (see `specs/flow.md`) starts the fog over.
- **Predators:** **never remembered.** A predator's body is drawn only while
  currently **lit** — inside your live vision this instant, during the brief window
  after a sonar pulse or flare catches it (below), or during its detection alert
  (`specs/predators.md`). Between glimpses it is invisible, wherever it is.
- **The two always-visible amber lights (the exception).** Two things are drawn
  **at all times, at any distance, even across unlit fog and through walls**: the
  **bonus drifter** and the **Lanternjaw's bulb-light** (`specs/playfield.md`,
  `specs/predators.md`). They are deliberately drawn to look **almost identical** —
  a single glowing amber point in the dark — so you always see them coming yet can
  never be sure, at a glance, which amber glimmer is a harmless drifter and which is
  a lurking Lanternjaw. (Only the Lanternjaw's *bulb* is always shown; its body
  still obeys the fog like any predator.)

This split is deliberate and keeps the game fair: once you have explored a region
you can navigate its corridors in the dark from memory; the darkness hides only
**where the predators are right now** — except for those two amber lights, which
are always in view.

## Passive vision — your light travels straight

The forager emits a soft light, so a pocket of maze around it is always **lit**.

- **Vision radius** `V` = **96 px** (3 tiles) at rest, growing with brightness up
  to **160 px** (5 tiles) — see Brightness below.
- **Line of sight (light travels straight).** A tile is lit by your passive light
  only if it is within `V` of the forager **and** the straight line from the
  forager's center to that tile is not blocked by a wall tile. Walls cast
  shadows: you **cannot see around a corner** with your own glow. A predator one
  tile away around a blind corner is not visible to your passive light.
- **Light reveals the walls it lands on, and stops there.** The rock that bounds a
  corridor your light reaches is **lit and revealed** too — a wall your light falls
  on is drawn as visible rock, never left as black fog — but the light does **not**
  pass beyond it: the tiles behind that wall stay dark. You see the wall itself, not
  what lies on its far side.
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
- **It widens your vision.** `V = 96 + 64 * G`: **`96 px` (3 tiles)** when dim, out
  to **`160 px` (5 tiles)** at full glow. Each plankton's `+0.34` is worth about
  **`+22 px` (~0.7 tile)** of extra vision radius, up to that 5-tile cap.
- **It gives you away to the Lanternjaw.** The Lanternjaw senses your light from a
  range that grows with `G` (defined in `specs/predators.md`). Eating fast to clear
  corridors quickly lights you up like a beacon; eating sparingly keeps you dim and
  hard to find. Managing this trade-off is core to the game.

## The sonar pulse — sound bends around corners

You can emit a **sonar pulse**: an active ability that reveals the maze ahead and
finds predators, at the cost of being heard. (The control is in
`specs/movement.md`.)

- **Cooldown.** A pulse is available on a **`1.5 s`** cooldown; the HUD shows a
  readiness gauge (see `specs/playfield.md`). The pulse recharges fairly quickly —
  its real cost is not the cooldown but that it is **heard** (it can hand the
  Gloamfin a fix), so you can afford to ping fairly often, just never carelessly near
  a Gloamfin.
- **Reveal (a wavefront through the corridors).** A pulse travels outward from the
  forager's tile **through open tiles only**, following the corridors like sound,
  out to a path range of **`E` = 9 tiles**. It does not reveal everything at once:
  the wavefront **expands over a fraction of a second**, so each open tile within
  `E` corridor-steps becomes revealed (and **remembered**) **as the front reaches
  it** — near tiles first, far tiles a moment later — **along with the wall tiles
  that bound those corridors**, so a pinged passage is drawn as corridor *and* rock,
  not a ribbon of floor floating in black. Because it follows the corridors, the
  pulse **reveals around corners and bends through junctions** — unlike your
  straight-line light — but it does not pass through walls, so a chamber sealed off
  by rock is not revealed unless a corridor reaches it within range.
- **Find predators.** Any predator or the drifter standing on a tile in the
  flooded set is **marked**: shown at its position for **`1.5 s`** after the
  pulse, as a fading glimpse, even where your light does not reach. This is how
  you locate a hunter around a corner before committing to a route.
- **You are heard.** Emitting a pulse makes noise: if the wavefront reaches the
  **Gloamfin** it hands the Gloamfin a **fix on you** and sets it chasing (see
  `specs/predators.md`) — and, like the reveal, this lands **when the front arrives**
  at the Gloamfin, not the instant you ping. A pulse is never free — ping when you
  need to know, not constantly, and not when a Gloamfin is close.
- **Presentation — a travelling wavefront, not a sprite.** Draw the pulse as a
  glowing crest that **flows outward through the corridors** — bending around bends
  and reflecting off the walls exactly as the reveal does — so it is never a
  misleading expanding circle. There is **no sonar sprite**; render the wavefront
  procedurally. At each corridor tile the front has reached, draw the crest as a
  short **arc that bulges in the direction the sound is travelling** — a `(` heading
  left, a `)` heading right — swinging round as the pulse turns a corner and
  reflects, so a run of tiles reads as a marching train of expanding ripples. The
  crest is **brightest right at the leading edge** and fades behind it; the origin,
  which has no heading, opens as a full ring. Tint the forager's pulse the **sonar
  color `#5ef2ff`**. It is a **large area effect** — it spreads across many tiles,
  well beyond a single tile or the forager's own sprite — drawn as its own overlay,
  not as part of any character. The drawn crest is presentation only; the actual
  reveal is the flooded tile set as the front reaches each tile. The Gloamfin emits
  the **same** wavefront as its tell, tinted to its own color — but the Gloamfin's
  ping reveals nothing (see below and `specs/predators.md`).

## The two rules, together

The heart of Fathom's sensing is that **light and sound propagate differently**:

- **Light travels straight** — your constant passive vision shows only what is in
  direct line of sight around you, never around corners.
- **Sound bends around corners** — a sonar pulse follows the open corridors and
  reveals and finds predators beyond the bend, but it is loud.

So you always see your immediate surroundings for free but learn nothing about the
next corridor without pinging, and pinging is what the Gloamfin is waiting for.

## Enemy effects — what reveals the maze, and what does not

The two enemy effects that spread across the trench behave differently, and this
distinction matters:

- **The Flarefish's flare reveals tiles for you.** At the bloom it lights a full
  **`192 px` (6-tile) radius** around the Flarefish — **floor and wall alike, and
  straight through walls** (the flare ignores rock) — revealing (and remembering)
  that whole disc, and showing any predator or the drifter inside it live. For as
  long as the bloom burns, the **whole disc is drawn at full light** (moving with the
  Flarefish), and it **fades back to the remembered dim** across the flare's final
  fade — the tiles stay revealed, they just drop from lit back to normal remembered
  brightness. It is a gift of vision (`specs/predators.md`).
- **The Gloamfin's ping reveals nothing.** Its violet sonar wavefront is **visible
  to you** — you watch it sweep outward through the corridors toward you — but it
  does **not** draw the Gloamfin itself, light the maze, reveal or remember any tile,
  or mark any other predator or a drifter. It is a warning you can see, not a map,
  and not even a fix on the hunter that cast it (`specs/predators.md`).

## How predators reveal themselves

You are never left fully blind to a predator: in addition to catching them in your
light or a sonar pulse, **each leaks a tell of its own** — the Lanternjaw's
always-visible amber **bulb**, the Gloamfin's own periodic **violet pings**, the
Flarefish's **flare bloom** (and, for the Gloamfin and Flarefish, the **detection
alert** that fires the instant they acquire you). Those tells, and exactly how each
predator senses and hunts you, are defined in `specs/predators.md`.
