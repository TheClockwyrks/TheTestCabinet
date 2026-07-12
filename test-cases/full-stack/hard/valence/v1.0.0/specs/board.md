# Valence — The board: conduits, nodes, and the HUD

This file defines the playfield: the conduit matter travels, how it forks into two lanes
and rejoins, how matter is split across the lanes, the fixed emitter nodes where towers
go and what each covers, and the top status bar and right build panel. It builds on the
stage in `specs/overview.md` and connects to the matter (`specs/matter.md`), the towers
(`specs/towers.md`), the controls (`specs/controls.md`), and the flow (`specs/flow.md`).

The board occupies `x` in `[0, 1000]`, `y` in `[56, 720]` (`specs/overview.md`) and is
shown **whole** — there is no scrolling camera; the entire conduit and every node are
visible at once.

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

## Emitter nodes

Towers are **not** placed freely — the board has a fixed set of **emitter nodes**, the
only places a tower can be built, and **one tower** occupies a node. There are **16**
nodes, placed beside the conduit and fixed for this version (you design their exact
positions within the rules below). An empty node is drawn as a clear marker
(`specs/overview.md`); the currently hovered or selected node is highlighted, and its
tower's **range** is previewed (`specs/controls.md`).

Distribute the nodes so the board rewards thought about **coverage**, not just density:

- Some nodes sit beside **Lane A only** and some beside **Lane B only** — a tower there
  reaches units on that lane while they travel it, and not the other lane.
- Some nodes sit by the **shared runs** — the inlet approach before the splitter, the
  confluence, and the shared final run — where a tower reaches **both** lanes' traffic
  (every unit passes the inlet approach and the shared final run). These shared-run nodes
  are the premium positions and there should be **fewer** of them than lane nodes.

Roughly: about six nodes on each lane and about four on the shared runs, so a player must
choose between blanketing one lane, covering both cheaply near the merge, or hitting
everything early at the inlet. A tower's **range** (`specs/towers.md`) then decides how
much of the conduit near its node it actually reaches.

### Range and targeting

- A tower's **range** is a radius in logical pixels measured from its node. A unit is
  targetable while the point it occupies on the conduit lies within that radius.
- By default a tower fires at the in-range unit **furthest along** the conduit toward the
  collector — the standard "first" target — so it works on the most urgent threat. Splash
  and aura towers differ as noted in `specs/towers.md`.
- A tower fires **automatically** at its fire rate whenever it has a valid target; there
  is no manual trigger. What counts as a *valid* target depends on the tower and the
  unit's form (a Shear only targets molecules, an Ionizer only free reactive atoms, and so
  on — `specs/towers.md`, `specs/matter.md`); a tower with nothing valid in range holds
  fire.
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
