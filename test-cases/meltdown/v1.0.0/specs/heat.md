# Heat

## Overview

This file defines the signature Heat system of Meltdown: how an emitter's heat
drives its power up to a per-tower **redline** and holds it there, how pushing all
the way to the trip takes it offline, how a tower sheds heat only through the
faces that touch **open air**, how heat **conducts** between packed towers, and how
the **Forge** and **Sink** move heat to and from their neighbors. **Read this file
carefully.** It builds on the tile grid and tower footprints in
`specs/playfield.md` and is the rule that the towers in `specs/towers.md` are all
built on.

## Emitter Heat

Each emitter (every tower that fires — the six in `specs/towers.md`; the Forge and
Sink do not fire and have no heat of their own) carries a heat value `H`, a number
from `0` (stone cold) to `100` (the trip). Heat is shown on its footprint and in
the inspector (see `specs/playfield.md`), and it changes continuously as the tower
runs:

- **Firing heats it.** Each shot a tower fires adds `heatPerShot / mass` to `H`
  (`mass` is the tower's thermal mass, below). A fast-firing or heavy-hitting tower
  piles on heat quickly; a slow one trickles it on.
- **Cooling is a *thermal budget*, not a fixed rate.** Unlike a lone radiator, a
  tower loses heat only through its footprint faces that reach the outside — the
  **surface-cooling** rule below. How fast it cools is therefore a function of
  **where it sits on the floor**, not just what it is.
- Heat is clamped to `[0, 100]` and never goes negative.

Because firing adds heat and cooling grows with heat, a tower that keeps firing
does **not** climb forever — it settles toward a stable **ceiling** where gain and
loss balance. Where that ceiling lands depends on how busy the tower's lane is
(how often it has a target) **and** on how well it can shed heat (its placement).
The whole game is placing a tower so that ceiling lands where you want it: hot
enough to hit hard, not so hot it trips.

## Thermal Mass

Every emitter has a **thermal mass** `mass` (`specs/towers.md`). Mass divides
**every** heat change — the per-shot gain and every cooling/heating flow below — so
it changes only how *fast* a tower responds, **not where it settles** (the ceiling
is mass-independent). A **low-mass** tower is twitchy: it whips up to its ceiling
and back down fast, spiking on a dense clump and cooling fast in a lull. A
**high-mass** tower is sluggish: slow to warm from cold, but once hot it rides
through lulls without cooling much. Low mass wants a **Sink** to tame its spikes;
high mass wants a **Forge** to pre-warm it and hold it hot. The time constant is
`tau = 100 * mass / (surface-cooling coefficient)`.

## Damage Scaling and the Redline

An emitter **fires harder the hotter it runs**, up to a point. Its damage per shot
is its base damage scaled by a heat multiplier that rises on an accelerating curve
to the tower's **redline** `R`, then **holds flat at maximum** from `R` up to the
`100` trip:

```
damage = baseDamage * heatMultiplier(H, R)
heatMultiplier(H, R) = 0.35 + 3.15 * (min(H, R) / R)^2    (flat 3.5x for H >= R)
```

So at `H = 0` a shot does only **0.35x** base damage; the multiplier climbs
quadratically to **3.5x** at `H = R`, and **stays at 3.5x** for all `H` from `R`
to `100`. A cold tower is genuinely **feeble** — barely a third of its base
damage — and a tower at or above its redline is three-and-a-half times the base
value. A wall of never-firing cold towers is therefore not a defence: heat is
where nearly all of a tower's damage lives, so you must funnel the surge past
your guns (a maze) to keep them hot.

- **The redline `R` is per-tower and is the max-efficiency mark** — the point where
  the tower reaches full power. It is **not** always `100`. A light, twitchy gun
  has a **low** redline (it reaches full power early and has a wide, forgiving
  plateau to sit in); a heavy, stable gun has a **high** redline (it only maxes out
  right near the trip, but is steady enough to be held there). Each tower's `R` is
  in `specs/towers.md`.
- **The band `[R, 100]` is the sweet spot:** full damage, still online. The redline
  marker on the heat read (`specs/playfield.md`, `specs/overview.md`) sits at `R`,
  so the player can see how much room a tower has between full power and the trip.
- The heat-averse **Rime** is the exception: it has no damage plateau (it slows,
  and slows best when *cold* — `specs/towers.md`); its redline is effectively the
  `100` trip.

This is the central pull of Meltdown: because a cold gun is half-strength, keeping
a tower **at its redline** is not a bonus but a requirement to pull real damage —
which means shaping the floor so each gun runs hot without tipping over.

## The Trip

If a tower's heat reaches `100`, it **trips**:

- The tower goes offline for a trip cooldown of `5.0 s` — it stops firing and
  deals no damage at all during that window.
- It is drawn unmistakably tripped: strobing red (`#ff3030`), visibly dead.
- Its heat bleeds off to `0` over the cooldown, and when the `5.0 s` elapse it
  comes back online cold (`H = 0`) and begins heating from scratch.

A tripped tower is a hole in your defense: for five seconds the surge walks past
it untouched. Tripping is the **only** way an emitter fails — towers are never
destroyed, never damaged by the surge, and have no ammo. The whole risk of running
hot is the trip, and the whole skill is riding the `[R, 100]` band for full damage
without tipping over.

## Surface Cooling — the Thermal Blanket

A tower is a hot body on a crowded floor: **it sheds heat only through the
footprint faces that touch the open floor (or the casing wall)**. This is the heart
of the redesigned heat system and the reason placement is a thermal puzzle.

Every tower footprint has four **faces** (N, E, S, W), each one tile-edge long per
tile of the footprint side (a `2 x 2` face is two edge-tiles; a `4 x 4` face is
four). Each perimeter edge-tile cools according to what lies just outside it:

- **Facing open air (open floor, a vent/exhaust opening, or the off-grid casing
  wall):** the edge sheds heat. A **radiator face** sheds well; a plain face sheds
  little (the exact per-edge rates are below).
- **Facing another tower (emitter, Forge, or Sink):** that edge sheds **no** heat
  to air — the neighbor is in the way. Instead it either **conducts** (emitter
  neighbor) or exchanges heat with the mover (Forge/Sink), below.

The consequence is the **thermal blanket**: a tower **boxed in** by other towers
has no open faces, cannot dump its heat, and — if it is firing — **cooks itself to
the trip**. A dense block of guns bakes its own core. An open or lightly-mazed
tower, with faces on the open lane, cools freely. So packing towers tight (for
short paths, or to line up Forges) now carries a real **heat cost**, and the
classic long, thin maze — every tower with open air around it — regains a genuine
thermal advantage. A single lone tower has all four faces open and cools exactly as
a free radiator would.

### Radiator faces and rotation

Not all faces cool equally. Each emitter designates some of its faces as
**radiator faces** — heat-sink sides that shed heat far better than a plain face
(the surface-cooling rates: a radiator edge sheds `3.6` per edge-tile at `H = 100`,
a plain edge only `1.1`, both proportional to `H / 100`). Which faces are radiators
is per-tower (`specs/towers.md`), given in the tower's **local** orientation.

A tower can be **rotated** in `90°` steps (`specs/controls.md`), which turns its
radiator faces with it (local `N → E → S → W`). So the player controls cooling not
only by *how many* faces touch open air but by *aiming the radiator faces at the
air*: the same tower in the same spot can sit safely in its plateau or trip,
depending purely on which way it faces. This rewards deliberate formations — corners
and diamond shapes that give a tower three open sides, radiator faces turned toward
the open lane, and packing that deliberately blocks a face to run a neighbor
hotter. A tower's radiator faces are drawn as cool cyan fin marks on its footprint
(`specs/overview.md`).

## Conduction Between Neighbors

When two **emitter** footprints touch along an edge, heat **conducts** across the
shared edge to equalize them: each second, heat flows by `3.5 * sharedEdgeTiles`
per degree of difference, from the hotter tower to the cooler (divided, as always,
by each tower's mass). Movers (Forge/Sink) have no heat and do not conduct.

Conduction is why a dense block tends toward a single common temperature — you
cannot keep a white-hot core touching a cold cryo pocket; they bleed into each
other. It is also a tool: a boxed-in interior tower can only lose heat by
conducting into a **cooler** neighbor, so a deliberately-cool neighbor (or a
Sink, below) becomes the drain for a hot core. And it is a hazard for the Rime: a
Rime that touches hot guns is conducted *up* toward their heat, and a hot Rime has
stopped slowing (`specs/towers.md`).

## The Forge and the Sink

Two structures do not fire and have no heat of their own; their entire job is to
**move heat** to and from the emitters whose faces touch them. Both are `2 x 2`.
Contact is by **shared footprint edge-tiles**, exactly like conduction — a face of
the emitter must touch the mover's footprint.

- **The Forge is a thermostat.** It warms each touching emitter **toward** a
  **setpoint**, and only while the emitter is *below* it: it adds
  `0.9 * sharedEdgeTiles * max(0, setpoint - H)` heat per second. Because it only
  ever pushes *up to* the setpoint, a Forge can **never shove a gun past that
  setpoint on its own** — it wakes a cold gun to a strong, safe heat and then gets
  out of the way, instead of the old runaway that tripped anything it touched. Its
  setpoint **rises with its level** (`72 → 84 → 96`, `specs/towers.md`), so a base
  Forge holds a neighbor comfortably hot and only a maxed Forge can drive a
  high-redline gun (the **Lance**) up into its top plateau. Use it to wake cold
  guns and feed a sniper; keep it off anything you need to run cold.
- **The Sink is a coolant loop.** It adds strong cooling to each touching emitter's
  faces — `sinkOutput * sharedEdgeTiles * (H / 100)` per second, proportional to
  heat so it bites hardest near the trip and barely touches a cool gun. Crucially,
  a Sink cools **through a face that would otherwise be blocked**, so it is the
  **only way to cool a boxed-in tower**: thread Sinks through a dense core and the
  core holds instead of baking. Its output **rises with its level**
  (`16 → 24 → 36` per edge, `specs/towers.md`). Sinks stack, and shield a Rime from
  stray heat.

Both are still **walls** like any tower (`specs/playfield.md`), so they also shape
the maze, and a face touching a mover sheds no heat to air. Where you place and how
you pack a Forge or a Sink is as much a part of the puzzle as where the guns go.

## Tower Heat Relationships

Every tower relates to heat in one of three ways:

- **Heat-hungry** — most emitters (Arc, Stutter, Lance, Bloom, Flak of
  `specs/towers.md`). Hotter means more damage, up to their redline, held to the
  trip. They *want* to sit in their `[R, 100]` plateau, which means enough targets
  and enough cooling to hold there — a Sink if they run too hot, a Forge if they
  run too cold. Bigger emitters heat harder and want more open air (or Sinks).
- **Heat-averse** — the cryo Rime. It runs the rule **backward**: heat *degrades*
  it. It slows best cold and its slow fades as it heats (`specs/towers.md`). Keep it
  in open air or beside a Sink, away from Forges and hot cores.
- **Heat-movers** — the Forge (a thermostat source) and the Sink (a coolant drain).
  No heat of their own; they exist only to reconcile the hungry and the averse on
  the same floor.

A good floor is a deliberate thermal landscape: a white-hot core held in its
plateau by threaded Sinks and open radiator faces, a Forge feeding a slow heavy
gun, a cold cryo pocket off in open air — with the surge threaded through all of
it, running every gun as hot as you dare.
