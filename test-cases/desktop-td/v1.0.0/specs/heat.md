# Meltdown — Heat: power, the redline, coupling, and stances (signature)

This file defines the signature system of Meltdown: how an emitter's **heat**
drives its **power**, how pushing past the **redline** trips it offline, how the
Forge and Vent move heat between neighbors, and the three thermal **stances**
the towers fall into. **Read this file carefully.** It builds on the tile grid
in `specs/playfield.md` and is the rule that the towers in `specs/towers.md` are
all built on.

## Every emitter has a heat value

Each **emitter** (every tower that fires — the six in `specs/towers.md`; the
Forge and Vent do not fire and have no heat of their own) carries a **heat**
value `H`, a number from **`0`** (stone cold) to **`100`** (the **redline**).
Heat is shown on the tile and in the inspector (see `specs/playfield.md`), and
it changes continuously as the tower runs:

- **Firing heats it.** Each shot a tower fires adds its **`heatPerShot`** to
  `H`. A fast-firing or heavy-hitting tower piles on heat quickly; a slow one
  trickles it on.
- **Idling cools it.** At all times `H` also falls by the tower's **`coolRate`**
  per second (in heat units/second). So a tower with a target in range climbs
  (its firing outpaces its cooling); a tower with no target in range falls back
  toward `0`.
- Heat is **clamped to `[0, 100]`** and never goes negative.

A tower's per-type `heatPerShot` and `coolRate` are in `specs/towers.md`.
Whether a tower is heating or cooling at any moment is therefore a function of
**how often it has a target in range** — which is a function of **how the surge
flows past it**, which is a function of **the maze the player built**. Heat is
the bridge between the maze and the guns.

## Heat is power — damage climbs with heat

An emitter **fires harder the hotter it runs.** Its damage per shot is its base
damage scaled by a **heat multiplier** that rises with `H` on an
**accelerating** curve:

```
damage = baseDamage * heatMultiplier(H)
heatMultiplier(H) = 1 + 2 * (H / 100)^2
```

So at `H = 0` a shot does **1.0x** base damage; at `H = 50`, **1.5x**; at `H =
80`, **2.28x**; and just under the redline, near `H = 100`, **3.0x** — its
hardest hit. The curve is **quadratic**, so the last stretch toward the redline
is where the real power is: a tower idling cold is feeble, and a tower run right
up near the redline is three times the gun. The visual glow tracks this exactly
— cold blue is weak, white-hot is lethal (see `specs/overview.md`).

This is the central pull of Meltdown. To get a tower's damage you must keep it
**hot**, which means feeding it a steady stream of targets — but the same heat
that powers it is also what can take it offline.

## The redline — the only failure

If a tower's heat reaches **`100`**, it **trips**:

- It **goes offline** for a **trip cooldown of `3.0 s`** — it stops firing and
  deals no damage at all for that window.
- It is drawn unmistakably **tripped**: strobing red (`#ff3030`), visibly dead.
- Its heat **bleeds off to `0`** over the cooldown, and when the `3.0 s` elapse
  it comes back online cold (`H = 0`) and begins heating again from scratch.

A tripped tower is a **hole in your defense**: for three seconds the surge walks
past it untouched. Tripping is the **only** way an emitter fails — towers are
never destroyed, never damaged by the surge, and have no ammo or other limit.
The whole risk of running hot is the redline, and the whole skill is riding up
near it for the damage without tipping over.

Because firing rate (and thus heat gain) is driven by how many targets sit in
range, a **tight kill-box** where the surge is packed and a tower never stops
firing will **climb to the redline and trip**, gapping right when you need it
most; a tower with **breathing room** between targets stays online but never
gets as hot, so it hits softer. Shaping the maze is choosing, tower by tower,
where on that trade-off to sit — and the Forge and Vent let you cheat it
locally.

## Thermal coupling — the Forge and the Vent

Two structures do not fire at all; their entire job is to **move heat** to and
from the emitters next to them. "Next to" means the **four orthogonally adjacent
tiles** (up, down, left, right — not diagonals).

- **The Forge** *adds* heat to each adjacent emitter, **continuously**, every
  second it stands — its `forgeHeat` is poured into every orthogonal neighbor's
  `H`. This is the double-edged structure: in a lull, a Forge keeps a neighbor
  **warm and strong** when it would otherwise cool to feeble; in a heavy push,
  that same constant heat **stacks on top of** the neighbor's own firing heat
  and **shoves it over the redline**, tripping it. The Forge is both the asset
  that keeps a cold sniper lethal and the liability that melts down a busy core
  — its good and its bad are the *same property*.
- **The Vent** *removes* heat from each adjacent emitter, continuously — its
  `ventCool` is subtracted from every orthogonal neighbor's `H` each second, on
  top of that tower's own cooling. A Vent lets a tower that would otherwise trip
  be run **flat out** without tipping over: park a redline-prone emitter beside
  a Vent and it can fire continuously and stay online. It is the brake that lets
  you build the hot core you could not otherwise hold.

The exact `forgeHeat` and `ventCool` values, and how upgrading these structures
changes them, are in `specs/towers.md`. Coupling is **local** — only orthogonal
neighbors are affected — so where you place a Forge or a Vent on the floor is as
much a part of the puzzle as where you place the guns. Heat does not otherwise
spread between emitters: an ordinary emitter does not heat or cool its
neighbors, only the Forge and Vent do.

## The three thermal stances

Every tower relates to heat in one of three ways. Reading the floor is reading
which tower wants what:

- **Heat-hungry** — most emitters (the Arc, Stutter, Lance, Bloom, and Flak of
  `specs/towers.md`). They follow the rule above: hotter means more damage, up
  to the redline, where they trip. They *want* heat, but fear the cliff — so
  they want a steady stream of targets, and a Vent nearby if they run too hot or
  a Forge nearby if they run too cold.
- **Heat-averse** — the cryo **Rime**. It runs the rule **backward**: heat does
  **not** power it, heat **degrades** it. The Rime slows the surge best when it
  is **cold**, and its slow weakens as it heats (see `specs/towers.md` for the
  exact curve). It still trips at the redline like any emitter, but you almost
  never want it near one: keep a Rime **isolated** or beside a **Vent**, away
  from Forges and hot cores, so it stays cold and slows hard.
- **Heat-movers** — the **Forge** (a source) and the **Vent** (a sink). They
  have no heat of their own and never fire; they exist only to push heat into or
  pull heat out of their neighbors, so you can reconcile the hungry and the
  averse on the same floor.

The maze sets each tower's **baseline** heat — packed lanes run hot, open lanes
run cold — and the movers let you **override** that baseline tile by tile: warm
a sniper the maze left cold, cool a core the maze overloaded, and quarantine the
cryo line from both. A good floor is a deliberate thermal landscape: a white-hot
core held just under the redline by Vents, a Forge keeping a slow gun fed, and a
cold cryo pocket off on its own — with the surge threaded through all of it.
