# Fathom — The predators

This file defines the three predators: how each one moves, how each senses and
hunts you, the tell each gives off, and how the den releases them. It builds on
the maze and den in `specs/playfield.md`, the sensing systems in
`specs/sensing.md`, the movement and ink in `specs/movement.md`, and the match
flow in `specs/flow.md`.

There are exactly **three** predators, each keyed to a different signal you give
off. None of them can be eaten — there is no power-up that turns them into prey.
The only ways to survive are to stay undetected, to break their fix, and to
out-maneuver them.

## Shared movement and states

All predators move on the tile grid, along corridor centers, choosing a direction
at each junction. Each predator is always in one of two states:

- **Patrol** — it does not know where you are. It **wanders**: at junctions it
  picks an open direction at random, preferring not to immediately reverse, so its
  path is unpredictable. It moves at its patrol speed (below).
- **Hunt** — it has a **fix** on you (a tile it believes you are at, set by its
  sense, below). At each junction it takes the open direction that most reduces
  the grid distance to the fix — a steady, greedy pursuit. When it can no longer
  sense you, it keeps hunting the last fix for that predator's **linger** time,
  then reverts to patrol.

Predators move through wrap tunnels like the forager. **Contact** — a predator's
body overlapping the forager — costs a life (see `specs/flow.md`). Predators get
faster in deeper trenches (see Depth in `specs/flow.md`).

**Render each from its provided sprite** (`specs/assets.md`), facing its direction
of travel with its swim cycle: the Lure from `assets/lanternjaw/`, the Listener
from `assets/gloamfin/`, the Flarefish from `assets/flarefish/`. Their two
signature effects — the sonar pulse and the flare bloom — are separate provided
effect sheets, called out where each appears below. Do not draw substitute
creatures or effects.

## The den and release

All three predators begin each trench (and respawn after you lose a life) inside
the **den** (`specs/playfield.md`), and leave through the den gate on a schedule:

- **The Lure** leaves immediately (at release time `0`).
- **The Listener** leaves **`5 s`** after release.
- **The Flarefish** leaves **`10 s`** after release.

When you lose a life, all surviving predators return to the den and re-release on
the same schedule, giving you a moment to reorient.

## The Lure — hunts your light (amber)

The Lure is drawn to your glow. The more recently you have eaten, the farther it
finds you.

- **Sense.** The Lure senses you when you are within its detection range and in
  its line of sight (its sensing is light, so a wall between you breaks it). Its
  **detection range** scales with your brightness `G` (see Brightness in
  `specs/sensing.md`): `R = 128 + 192 * G` — about **4 tiles** when you are dim,
  up to about **10 tiles** when you are fully lit from eating. While it senses
  you, its fix is your current tile; **linger** after losing you is **`2 s`**.
- **Tell (anti-blindside).** The Lure carries a small dangling **lure-light** (it
  is on the Lure's sprite; its **lure-bob** frames are the beckoning animation —
  see `assets/lanternjaw/` in `specs/assets.md`). Its glow is faintly visible to
  you as a dim point at up to about **3 tiles**, in line of sight, even in
  otherwise unlit water — so you can sometimes spot the Lure before it closes,
  especially in the dark when you are dim.
- **Counter.** Go **dim** — stop eating and let `G` decay — to shrink its range
  and slip out of its sight, or drop **ink** (it hunts by sight, so ink blinds it;
  see `specs/movement.md`). Eating a streak of plankton near the Lure lights you
  up and pulls it straight to you.
- **Speed.** `116 px/s`, slightly slower than the forager, so a clean straight run
  loses it once you are dim or behind a wall.

## The Listener — hunts your sound (violet)

The Listener is eyeless and hunts by sound. It is the predator your **sonar** is
waiting for.

- **Sense.** A **sonar pulse** (`specs/sensing.md`) gives the Listener a
  precise fix on your tile and pulls it hard: it hunts for **`5 s`** after a pulse,
  the timer refreshed by each new pulse. It also hears you at very close range —
  within about **2 tiles**, in or out of line of sight, it knows your tile — so
  you cannot creep straight past it. Otherwise it patrols. **Ink does not affect
  it.**
- **Tell (anti-blindside).** The Listener emits **its own sonar pulses** about
  every **`3 s`** — the **same large expanding sonar-ring effect** the forager's
  pulse uses (the provided `assets/sonar-pulse/` sheet, here tinted to the
  Listener's violet rather than the forager's cyan — see `specs/sensing.md` and
  `specs/assets.md`), spreading well beyond the Listener's own sprite: you see the
  ring and it briefly lights a small area around the
  Listener for you too — so its hunting reveals its own position, and ironically
  helps you see.
- **Counter — the juke.** The Listener is **faster than you at top speed but slow
  to change direction**, so you lose it by cornering. Specifically:
  - Patrol speed **`120 px/s`**. When hunting it **accelerates** at `50 px/s^2`
    toward a top speed of **`184 px/s`** — faster than the forager's `128`, so it
    runs you down on a straightaway.
  - But it can only **take a turn at a junction when its speed is at or below
    `130 px/s`**. Moving faster than that, it **cannot corner**: it overshoots
    straight through the junction and must decelerate before it can turn back.
  - So a Listener at full chase barrels past tight turns. **Juke it**: make sharp
    turns down side corridors it is going too fast to follow, forcing it to
    overshoot, slow, and loop back while you gain ground. Pinging near it does the
    opposite — it refreshes the fix and feeds the chase.

## The Flarefish — hunts in its flare's light (orange)

The Flarefish is blind between flares: it only knows where you are when its own
flare catches you. Its flare is a gift and a threat at once.

- **Flare.** About every **`7 s`** the Flarefish emits a **flare**: a bright bloom
  lighting a radius of about **`192 px`** (6 tiles) around itself for **`1 s`**,
  preceded by a roughly **`0.5 s`** charge-up glow that telegraphs it. The bloom
  is a **large radial light effect** — charge-up, bloom, then fade — rendered from
  the provided **flare-bloom** effect sheet (`assets/flare-bloom/`, see
  `specs/assets.md`): play its charge/bloom/fade frames as its own overlay
  centered on the Flarefish and scaled far larger than the creature's own sprite,
  not part of it. The flare **reveals that area to you** — its geometry is
  revealed (for as long as `specs/sensing.md` keeps it revealed), and any predator
  or the drifter inside it is shown live during the bloom — so a Flarefish flaring
  nearby is free reconnaissance.
- **Sense.** If the **forager is within the flare's lit radius at the bloom**, the
  Flarefish **acquires a fix** and hunts you for **`4 s`** (refreshed if a later
  flare catches you again). If you are **not** in the light at the bloom, it
  learns nothing and keeps patrolling. Between acquisitions it does not know where
  you are.
- **Tell (anti-blindside).** The **charge-up glow** before each flare telegraphs
  both the flare and the Flarefish's location.
- **Counter.** When you see a flare charging, **break out of its lit radius or get
  behind a wall** before the bloom so it cannot acquire you — or drop **ink** (it
  hunts by sight, so ink blinds it and breaks the acquisition even inside the
  flare). Use its flares to map the trench, but never get caught standing in one.
- **Speed.** `116 px/s`.

## Reading the three at once

Each predator answers to a different one of your signals — **light** (Lure),
**sound** (Listener), **flare-light** (Flarefish) — and each has a distinct tell
and a distinct counter. That is the puzzle of the dark: eat to progress but go
dim near the Lure, ping to see but not near the Listener, exploit the Flarefish's
light without standing in it, and keep ink for the two that see.
