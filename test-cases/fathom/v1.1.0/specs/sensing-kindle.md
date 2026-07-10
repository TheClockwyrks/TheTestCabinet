# Fathom — Sensing: the kindle-glow, light, sonar, and brightness (signature)

This file defines how you perceive the dark trench: what is hidden, what your
kindle-glow shows, what your light and a sonar pulse reveal, and how eating makes
you glow. These are the signature systems of Fathom — read this file carefully. It
builds on the tile grid in `specs/overview.md` and the maze in
`specs/playfield.md`, and it cross-references the predators in
`specs/predators.md`.

The dive is **Kindle**: you graze the plankton of one dark trench while the three
predators hunt you, descending to deeper, faster trenches as you clear each one
(see `specs/flow.md`), until your last life is lost. Its defining twist is that
**your light is a glow you feed by eating**: it swells into a wide bubble of sensed
rock while you graze and gutters back down when you stop, and it senses only the
**shape** of the trench — never the plankton or the predators in it. The **mode
label** shown in the HUD (see `specs/playfield.md`) reads `KINDLE`.

## Fog of war — nothing is remembered

The trench is dark, and **it stays dark behind you**. A tile is in one of two
visibility states at any moment, and it is drawn differently in each (colors from
`specs/overview.md`):

1. **Dark** — not revealed by any source right now. Drawn as flat fog
   (`#03060c`); you cannot tell wall from open water, and nothing on it is shown.
2. **Lit** — revealed *right now* by your kindle-glow, your light pocket, or a live
   sonar mark (all below). Drawn at full brightness, with glows.

There is **no remembered state**. Unlike a fog of war that maps the trench as you
explore it, Kindle keeps **nothing**: the instant a tile falls out of every
source's reach it returns to flat fog. Walls, plankton, predators, and the drifter
are all shown **only while currently lit** — leave a corridor and it goes black
again, exactly as it was before you arrived. You navigate by the moving pool of
light you carry, not by a map you have built. Descending to a new trench (see
`specs/flow.md`) changes nothing about this — every trench is read the same way.

Draw the maze itself from the provided **trench tiles** (`assets/trench-walls/`,
see `specs/assets.md`): the wall autotile, floor, fog, and den-gate tiles. The two
visibility states are **runtime shading on those tiles**, not separate art — lit
is the tile at full brightness, dark is the fog tile (or the flat fog color).

## The kindle-glow — a bubble of sensed rock (signature)

Your forager emits a **kindle-glow** that senses the **rock around you**: a circle
of maze centered on the forager is always **lit as terrain**, showing the walls and
corridor floor within it.

- **It is radial, not line of sight.** The kindle-glow lights every tile within its
  radius `R` of the forager, **including around corners** — it senses the shape of
  the rock enclosing you, not a straight-line view. (This is unlike your light
  pocket below, which does travel straight.)
- **It reveals terrain only.** The kindle-glow shows the **maze geometry** — walls
  and corridor floor — and **nothing else**. It does **not** reveal plankton, the
  predators, or the bonus drifter; those are found only by your light pocket or a
  sonar pulse (below). So you can see the *shape* of a corridor well ahead of you
  and still not know what plankton or hunter waits in it until you light it or ping
  it.
- **It grows as you eat and shrinks over time.** The radius `R` scales with your
  brightness `G` (see Brightness below), which rises each time you eat and decays
  when you stop:

  > **`R = 192 + 128 * G` px** — from **`192` px (6 tiles)** when you are dim, out
  > to **`320` px (10 tiles)** at full glow.

  So at rest the bubble is **larger than your straight-line light pocket but
  smaller than a sonar ping**; a streak of about **8 plankton** eaten in quick
  succession brings it out to roughly a **sonar ping's reach (`≈ 288` px, 9
  tiles)**, and eating on past that pushes it **larger than a ping**. Stop eating
  and it gutters back toward 6 tiles within a few seconds.

- **Presentation.** Draw the kindle-glow as a soft radial light pocket around the
  forager (the forager's color `#46f0e0`) that fades from full brightness at the
  center out to the fog at radius `R`, lighting the trench tiles it covers to full
  brightness and leaving everything beyond it flat fog. It is runtime light you
  draw around the sprite, not part of the art (see `specs/assets.md`).

## Your light pocket — seeing life, straight ahead

Feeding the kindle-glow shows you the rock, but to see **living things** — plankton,
the predators, the drifter — you rely on a smaller, ordinary **light pocket** that
travels straight.

- **Radius.** The light pocket reaches `V` = **`96` px (3 tiles)** at rest, growing
  with brightness up to **`160` px (5 tiles)** — `V = 96 + 64 * G` — always well
  inside the kindle-glow.
- **Line of sight (light travels straight).** A tile is inside the light pocket only
  if it is within `V` of the forager **and** the straight line from the forager's
  center to that tile is not blocked by a wall. Walls cast shadows: the light pocket
  **cannot see around a corner**.
- **It reveals life.** Plankton, the predators, and the drifter are drawn live only
  where the **light pocket** reaches them (or where a sonar pulse marks them, or a
  flare catches them — `specs/predators.md`). The kindle-glow alone never shows
  them. A predator one tile away around a blind corner is inside your kindle-glow
  as *terrain* but is **not** visible until your straight light, a pulse, or a flare
  reaches it.

## Brightness — eating makes you glow (risk dial)

Your brightness is a value `G` in `[0, 1]`, `0` when you have not eaten recently.

- Each plankton eaten adds **`+0.12`** to `G` (clamped at `1`). `G` then **decays**
  toward `0`, losing half its value every **`2.5 s`** (`G *= 0.5 ^ (dt / 2.5)`), so
  a forager that keeps grazing swells its glow while a forager that stops dims back
  down over a few seconds. (Because of the decay, swelling the glow takes a
  *sustained* streak, not a single mouthful: roughly **8 plankton** eaten in quick
  succession — faster than the decay bleeds `G` away — bring the glow to about
  `G ≈ 0.75`, the sonar-ping reach; a longer streak pushes it on toward full.)
- Brightness **grows the kindle-glow** (the terrain bubble radius `R`, above) and
  **widens the light pocket** (`V`, above): eating lights up the trench around you,
  far and near.
- Brightness **gives you away to the Lure**: the Lure senses your light from a
  range that grows with `G` (defined in `specs/predators.md`). Eating fast to clear
  corridors quickly swells your glow like a beacon; eating sparingly keeps you dim
  and hard to find, but nearly blind to the rock ahead. Managing this trade-off is
  core to the game.

## The sonar pulse — sound bends around corners

You can emit a **sonar pulse**: an active ability that reveals the corridors ahead
and finds predators, at the cost of being heard. (The control is in
`specs/movement.md`.) It is how you find the plankton and hunters your kindle-glow
hides from you.

- **Cooldown.** A pulse is available on a **`3.5 s`** cooldown; the HUD shows a
  readiness gauge (see `specs/playfield.md`).
- **Reveal (flood through corridors).** A pulse floods outward from the forager's
  tile **through open tiles only**, following the corridors like sound, out to a
  path range of **`E` = 9 tiles**. Every open tile within `E` corridor-steps — and
  **any plankton on it** — becomes lit, and any predator or the drifter standing on
  it is **marked** (below). Because it follows the corridors, the pulse **reveals
  around corners and bends through junctions** — reaching corridors and plankton
  beyond your light pocket — but it does not pass through walls.
- **It fades — nothing is remembered.** As everywhere in Kindle, a pulse reveals
  **only for a brief window**: the flooded corridors, the plankton on them, and the
  predator marks stay lit for **`1.5 s`** after the pulse, then fade back to flat
  fog. A pulse gives you a glimpse of what is around the bend, not a lasting map.
- **Find predators.** Any predator or the drifter in the flooded set is **marked**:
  shown at its position for **`1.5 s`** after the pulse, as a fading glimpse, even
  where your light does not reach. This is how you locate a hunter around a corner
  before committing to a route.
- **You are heard.** Emitting a pulse makes noise: it **strongly attracts the
  Listener** and alerts nearby predators (see `specs/predators.md`). A pulse is
  never free — ping when you need to know, not constantly.
- **Presentation.** Render an expanding ring from the forager to suggest the
  wavefront; the actual reveal is the flooded tile set, not a drawn circle. Use the
  provided **sonar-pulse** effect sheet (`assets/sonar-pulse/`, see
  `specs/assets.md`): it is drawn grayscale, so **tint it to the sonar-ring color**
  (`#5ef2ff`) and play its frames as the ring expands. The ring is a **large area
  effect** — it spreads across many tiles, well beyond a single tile or the
  forager's own sprite — drawn as its own overlay, not as part of any character.
  The Listener emits the **same** sonar-pulse effect as its tell, tinted to its own
  color (see `specs/predators.md`).

## The three rules, together

The heart of Kindle's sensing is that **rock, life, and sound reveal
differently**, and **the trench keeps no memory**:

- **The kindle-glow senses rock** — a wide bubble around you, bending around
  corners, that shows the *shape* of the trench but never the plankton or hunters
  in it, and swells or gutters with how recently you have eaten.
- **Your light shows life, straight ahead** — a small line-of-sight pocket is the
  only thing that reveals plankton and predators up close, and it cannot see around
  a corner.
- **Sound bends around corners** — a sonar pulse floods the open corridors and
  reveals the plankton and marks the predators beyond the bend, but it is loud and
  it fades in a moment.

So you always sense the rock around you and can navigate its corridors, but you are
half-blind to the plankton you are hunting and the predators hunting you until you
close on them or ping — and the moment you move on, the trench behind you goes dark
again.

## How predators reveal themselves

You are never left fully blind to a predator: in addition to catching them in your
light pocket or a sonar pulse, **each predator leaks a tell of its own** — the
Lure's faint lure-light, the Listener's own periodic pulses, the Flarefish's flare
bloom. Those tells, and exactly how each predator senses and hunts you, are defined
in `specs/predators.md`.
