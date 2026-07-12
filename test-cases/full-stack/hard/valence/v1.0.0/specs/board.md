# Valence — The board: conduits, the build grid, and the HUD

This file defines the playfield: the conduit matter travels, how it forks into two lanes
and rejoins, how matter is split across the lanes, the **build grid** the player places
towers on and what each covers, and the top status bar and right build panel. It builds on
the stage in `specs/overview.md` and connects to the matter (`specs/matter.md`), the towers
(`specs/towers.md`), the controls (`specs/controls.md`), and the flow (`specs/flow.md`).

The board occupies `x` in `[0, 1000]`, `y` in `[56, 720]` (`specs/overview.md`) and is
shown **whole** — there is no scrolling camera; the entire conduit and the whole build
grid are visible at once.

## The conduit

Matter travels a single fixed **conduit** — a smooth path (a polyline or spline) drawn as
a glowing channel over the substrate, with a visible sense of **flow direction** toward
the collector (`specs/overview.md`). Its **topology is fixed** for this version; its exact
geometry within the board is yours to design, and the whole of it must be on screen.

The topology is one inlet, a fork into two lanes, a merge, and a collector:

1. **Inlet.** A single entry point at one edge of the board where every unit spawns and
   begins traveling.
2. **Splitter.** A short shared run from the inlet reaches a **splitter junction** where
   the conduit **forks into two parallel lanes** — call them **Lane A** and **Lane B**.
   The two lanes run separately across the board.
3. **Confluence.** The two lanes **rejoin** at a **confluence junction** into a single
   **shared final run**.
4. **Collector.** The shared final run ends at the **collector** at the far edge — the
   exit. A unit that reaches the collector **leaks** (`specs/flow.md`).

The two lanes must be **visibly distinct paths** a player can point at, long enough that a
tower on one lane cannot trivially cover the other along its whole length. Lay them out so
the fork, both lanes, the merge, and the shared run all read clearly, and so a unit's
progress toward the collector is easy to follow. A single serpentine path with no genuine
fork does not implement this board.

### Which lane a unit takes

Each unit is assigned a lane **at spawn** and travels it from the splitter to the
confluence. By default the inlet **alternates** lanes — consecutive units go A, B, A, B,
… — so both lanes always carry traffic and both must be defended; a wave's composition may
weight the split (`specs/matter.md`), but the game must never funnel a whole wave down one
lane and leave the other empty. A unit that **fragments** (a molecule sheared apart, a
heavy fissioned — `specs/matter.md`) — spawns its fragments **on the same lane** at its
own position, so the fragments continue past the towers ahead on that lane.

Progress along the conduit is what matters for targeting and leaking; a unit does not
change lanes once assigned, and lanes do not cross.

## The build grid

Towers are placed on a **grid of build cells** that tiles the board — **not** at free
pixel positions (this is not the free placement of a Bloons-style game) and **not** at a
fixed handful of spots. The whole board region is divided into a uniform lattice of square
cells (about `40 px` on a side — you pick the exact size, but it must divide the board into
a clean grid, drawn as a faint lattice so the player can see the cells). Placement **snaps
to the grid**: a tower always occupies **exactly one cell** and sits at that cell's
**center**; it is never placed half on a cell or between cells.

The only restriction on *where* is the conduit itself:

- A cell the **conduit passes through** — the track of either lane, plus the inlet, the
  splitter, the confluence, and the collector — is **blocked**: no tower may occupy it. The
  conduit is fixed and towers never reroute it; there is no maze-building.
- Every **other** cell is buildable, and **one tower** occupies a cell — a cell that already
  holds a tower cannot take another.

So the player may build on **any** empty cell, choosing freely *along* the conduit's
length; the grid is the constraint on placement, not a fixed set of nodes. An empty
buildable cell is shown as a clear marker (`specs/overview.md`); the currently hovered or
selected cell is highlighted, and the held or selected tower's **range** is previewed
(`specs/controls.md`). While a tower is held for placement, the legal cells are cued and a
blocked or occupied cell is refused.

Coverage — not just density — is what the board rewards, and it falls out of the grid laid
over the branching conduit:

- A cell **beside Lane A only** reaches units on Lane A while they travel it, and not the
  other lane; likewise a cell **beside Lane B only** reaches Lane B.
- A cell beside a **shared run** — the inlet approach before the splitter, the confluence,
  or the shared final run — reaches **both** lanes' traffic (every unit passes the inlet
  approach and the shared final run). These shared-run cells are the premium positions, and
  the branching layout naturally leaves **fewer** of them than lane-side cells.

Design the conduit so the grid around it offers a real choice — blanket one lane, cover
both cheaply near the merge or the inlet, or spread thin. A tower's **range**
(`specs/towers.md`) then decides how much of the conduit near its cell it actually reaches;
a cell far from every lane is legal but reaches nothing.

### Range and targeting

- A tower's **range** is a radius in logical pixels measured from its cell's **center**. A
  unit is targetable while the point it occupies on the conduit lies within that radius.
- By default a tower fires at the in-range unit **furthest along** the conduit toward the
  collector — the standard "first" target — so it works on the most urgent threat. Splash
  and aura towers differ as noted in `specs/towers.md`.
- A tower fires **automatically** at its fire rate whenever it has a valid target; there
  is no manual trigger. What counts as a *valid* target depends on the tower and the
  unit's form (a Shear only targets molecules, an Ionizer only free reactive atoms, and so
  on — `specs/towers.md`, `specs/matter.md`); a tower with nothing valid in range holds
  fire.
- A damage tower's **head rotates to face its current target**, and each shot is a
  **projectile that travels to the unit and deals its effect on impact** — not an instant
  hitscan (`specs/towers.md`, `specs/assets.md`). The support towers are auras: they neither
  aim nor fire a projectile.
- When a tower is selected or held, draw its **range** as a ring so the player can see
  what it covers before committing (`specs/controls.md`).

## Top status bar

The **top status bar** (`y` in `[0, 56]`, full width — `specs/overview.md`) carries the
at-a-glance run state, drawn in code (`specs/assets.md`; only its small icons may be
produced sprites):

- **Energy** — current spendable energy (`specs/flow.md`), with its icon.
- **Integrity** — remaining integrity, with its icon; it turns to the alert color as it
  runs low.
- **Round** — `ROUND n / N` (the current round over the run's total), with a read of the
  current round's progress or the between-round build-phase countdown (`specs/flow.md`).
- **Global controls** — the game **speed** toggle and its current setting, **pause**, and
  a **mute** toggle (`specs/controls.md`, `specs/flow.md`).

## Right build panel

The **right build panel** (`x` in `[1000, 1280]`, `y` in `[56, 720]` — `specs/overview.md`)
is where the player builds and inspects, drawn in code (its small icons may be produced
sprites). It always shows, from top to bottom:

- **The shop** — one entry per tower type (`specs/towers.md`) with its name, cost, and
  icon, disabled when unaffordable. Hovering an entry shows that tower's info (role,
  range, what it targets, and its per-level effects) in the inspector area below.
- **The inspector** — context-sensitive: with a **built tower selected**, it shows that
  tower's type, level, live stats, and its **upgrade** and **sell** controls
  (`specs/towers.md`); with a **shop entry hovered**, it shows that tower's info; with
  **neither**, it shows the **next-round preview** — the types the coming round contains
  (`specs/matter.md`, `specs/flow.md`) — so the player can plan the board for it.
- **The round control** — the **START ROUND** button before the first round and between
  rounds (which also reads the build-phase countdown and pays the early-send bonus when
  pressed early, `specs/flow.md`), and the speed toggle as an alternative to the status
  bar's.

The build panel must always be fully visible (`specs/overview.md`). Everything a player
needs to read the run and act on it — energy, integrity, round, the shop, the selected
tower, and the coming round — must be reachable here without hunting.
