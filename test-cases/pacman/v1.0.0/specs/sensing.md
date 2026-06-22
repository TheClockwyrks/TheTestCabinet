# Fathom — Sensing: fog of war, light, sonar, and brightness (signature)

This file defines how you perceive the dark trench: what is hidden, what your
light shows, what a sonar pulse reveals, and how eating makes you glow. These are
the signature systems of Fathom — read this file carefully. It builds on the tile
grid in `specs/overview.md` and the maze in `specs/playfield.md`, and it
cross-references the predators in `specs/predators.md`.

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

**Fixed things are remembered for the whole trench; moving things are not.**

- **Walls and plankton:** once a tile is revealed by any source, it stays
  **remembered for the rest of the current trench** — including across losing a
  life. Descending to a new trench (see `specs/flow.md`) starts the fog over.
- **Predators and the bonus drifter:** **never remembered.** They are drawn only
  while currently **lit** — inside your live vision this instant, or during the
  brief window after a sonar pulse or flare catches them (below). Between glimpses
  they are invisible, wherever they are.

This split is deliberate and keeps the game fair: once you have explored a
region you can navigate its corridors in the dark from memory; the only thing the
darkness hides from a player who has explored is **where the predators are right
now**.

## Passive vision — your light travels straight

The forager emits a soft light, so a pocket of maze around it is always **lit**.

- **Vision radius** `V` = **96 px** (3 tiles) at rest, growing with brightness up
  to **160 px** (5 tiles) — see Brightness below.
- **Line of sight (light travels straight).** A tile is lit by your passive light
  only if it is within `V` of the forager **and** the straight line from the
  forager's center to that tile is not blocked by a wall tile. Walls cast
  shadows: you **cannot see around a corner** with your own glow. A predator one
  tile away around a blind corner is not visible to your passive light.
- Predators, the drifter, and plankton inside this lit set are drawn live.

## Brightness — eating makes you glow (risk dial)

Your brightness is a value `G` in `[0, 1]`, `0` when you have not eaten recently.

- Each plankton eaten adds **`+0.34`** to `G` (clamped at `1`). `G` then **decays**
  toward `0`, losing half its value every **`0.9 s`** (`G *= 0.5 ^ (dt / 0.9)`),
  so a forager that stops eating dims back to near-dark within about `2.5 s`.
- Brightness **widens your vision**: `V = 96 + 64 * G` (96 px dim, 160 px at
  full glow).
- Brightness **gives you away to the Lure**: the Lure senses your light from a
  range that grows with `G` (defined in `specs/predators.md`). Eating fast to
  clear corridors quickly lights you up like a beacon; eating sparingly keeps you
  dim and hard to find. Managing this trade-off is core to the game.

## The sonar pulse — sound bends around corners

You can emit a **sonar pulse**: an active ability that reveals the maze ahead and
finds predators, at the cost of being heard. (The control is in
`specs/movement.md`.)

- **Cooldown.** A pulse is available on a **`3.5 s`** cooldown; the HUD shows a
  readiness gauge (see `specs/playfield.md`).
- **Reveal (flood through corridors).** A pulse floods outward from the forager's
  tile **through open tiles only**, following the corridors like sound, out to a
  path range of **`E` = 9 tiles**. Every open tile within `E` corridor-steps
  becomes revealed (and **remembered**). Because it follows the corridors, the
  pulse **reveals around corners and bends through junctions** — unlike your
  straight-line light — but it does not pass through walls, so a chamber sealed
  off by rock is not revealed unless a corridor reaches it within range.
- **Find predators.** Any predator or the drifter standing on a tile in the
  flooded set is **marked**: shown at its position for **`1.5 s`** after the
  pulse, as a fading glimpse, even where your light does not reach. This is how
  you locate a hunter around a corner before committing to a route.
- **You are heard.** Emitting a pulse makes noise: it **strongly attracts the
  Listener** and alerts nearby predators (see `specs/predators.md`). A pulse is
  never free — ping when you need to know, not constantly.
- **Presentation.** Render an expanding ring from the forager to suggest the
  wavefront; the actual reveal is the flooded tile set, not a drawn circle. The
  ring is a **large area effect** — it spreads across many tiles, well beyond a
  single tile or the forager's own sprite — drawn as its own overlay (tinted to
  the sonar-ring color), not as part of any character. The Listener emits the
  **same** sonar-pulse effect as its tell (see `specs/predators.md`).

## The two rules, together

The heart of Fathom's sensing is that **light and sound propagate differently**:

- **Light travels straight** — your constant passive vision shows only what is in
  direct line of sight around you, never around corners.
- **Sound bends around corners** — a sonar pulse follows the open corridors and
  reveals and finds predators beyond the bend, but it is loud.

So you always see your immediate surroundings for free but learn nothing about the
next corridor without pinging, and pinging is what the Listener is waiting for.
A mode spec under `specs/modes/` may change these reveal rules (for example,
letting your passive light also bend around corners, or adding a second,
tighter-but-longer directional pulse); when a mode does, its mode spec states the
change, and otherwise the rules in this file apply.

## How predators reveal themselves

You are never left fully blind to a predator: in addition to catching them in your
light or a sonar pulse, **each predator leaks a tell of its own** — the Lure's
faint lure-light, the Listener's own periodic pulses, the Flarefish's flare bloom.
Those tells, and exactly how each predator senses and hunts you, are defined in
`specs/predators.md`.
