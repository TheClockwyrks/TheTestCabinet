# Valence — The board: maps, paths, free tower placement, and the HUD

This file defines the playfield: the **maps** the campaign offers, the **paths** matter
travels along each map (a single path, branching lanes, or several separate tracks), the
**path styles** (smooth curves vs straight right-angle runs), how matter is distributed
across a map's paths, how the player **freely places** towers on the board, and the top
status bar and right build panel. It builds on the stage in `specs/overview.md` and
connects to the matter (`specs/matter.md`), the towers (`specs/towers.md`), the controls
(`specs/controls.md`), and the flow (`specs/flow.md`).

The board occupies `x` in `[0, 1000]`, `y` in `[56, 720]` (`specs/overview.md`) and is
shown **whole** — there is no scrolling camera; the entire map (every path, every inlet
and collector) and everything built on it are visible at once, whichever map is in play.

## Maps

Valence ships **several maps**, and the campaign begins at a **MAP SELECT** screen
(`specs/flow.md`) where the player chooses which one to defend before the run starts. Each
map lays **one or more paths** over the board region; the maps differ in their **topology**
(how many paths and how they relate) and in their **path style** (curved or straight). The
map set **must** include at least these three, one at each difficulty:

- **Easy — a single path.** One inlet, one collector, one unbroken route across the board.
  No fork; every unit travels the same path.
- **Medium — branching paths.** A route that **forks into two (or more) lanes** the inlet
  assigns units across, so more than one lane must be defended at once. The lanes may run
  separately and **rejoin** into a shared final run, or diverge to their own collectors.
- **Hard — multiple separate paths.** **Two or more fully independent tracks** that never
  share a lane, each carrying its own traffic from its own inlet toward a collector. The
  player must cover several unconnected fronts with one board's worth of towers.

**Difficulty is topology, not numbers.** Every map plays the **same** 20-round campaign
with the **same** economy, integrity, matter roster, scaling, and towers
(`specs/flow.md`, `specs/matter.md`, `specs/towers.md`) — a harder map is harder **only
because its layout is harder to cover** (more lanes, more separate fronts, fewer premium
shared stretches). No map changes any pinned value.

### Path styles — curves and right angles

A path's geometry is drawn one of two ways, and the map set must show **both**:

- **Curved.** The path is a **smooth spline** (or dense curve) that sweeps and bends — no
  hard corners.
- **Straight / right-angle.** The path is an **axis-aligned polyline**: straight runs
  joined by **90° corners**, like circuitry.

**At least one map's paths must be smooth curves, and at least one map's paths must be
straight lines with right-angle corners.** (The single-path, branching, and multiple-path
maps above may each pick either style, so long as both styles appear somewhere in the
set.) Either way a path reads as a glowing channel over the substrate with a visible sense
of **flow direction** toward its collector (`specs/overview.md`), and its whole length is
on screen.

## Paths

A **path** is an ordered route from an **inlet** (where units spawn) to a **collector**
(the exit). A unit spawns at its path's inlet, travels the path, and **leaks**
(`specs/flow.md`) when it reaches that path's collector. Progress along a path is measured
as **arc length toward the collector**, so the unit **furthest along** a path is the one
nearest its collector — the standard "first" target (`specs/towers.md`).

- **Inlets and collectors are per path.** A map with several paths has several endpoints.
  Endpoints **may share a position**: several paths may start at one **shared inlet mouth**
  (one entry feeding multiple routes), several paths may end at one **shared collector**
  (multiple routes draining to one exit), or each path may have its own 1:1 inlet and
  collector. All three arrangements are allowed; each path is still its own route from
  start to finish.
- **Which path a unit takes.** Each unit is assigned a path **at spawn**. The inlet
  **distributes** units across the map's paths so **every path always carries traffic and
  each must be defended** — by default round-robin (consecutive units go to path 0, 1, 2,
  … and wrap), and while a wave's composition may **weight** the split (`specs/matter.md`),
  it must **never** funnel a whole wave onto one path and leave another empty. A unit does
  **not** change paths once assigned. A unit that **fragments** (a bonded cluster chipped
  apart, an isotope decaying into alpha/beta particles, a boss shedding — `specs/matter.md`)
spawns its fragments on the
  **same** path at its own position, so they continue past the towers ahead of it.
- **Branching as shared segments.** A branching map's fork is two paths that **coincide**
  on a shared trunk (the inlet approach) and/or a shared final run, then **diverge** into
  distinct lanes between them. Where paths overlap, one tower covers **both** — those
  shared stretches are the **premium** coverage, and a branching layout naturally leaves
  **fewer** of them than lane-only stretches. On a **multiple-separate-paths** map no
  stretch is shared, so coverage cannot be doubled up — every front costs its own towers.

A single serpentine path is a perfectly good **Easy** map, but it does not satisfy the
**Medium** (a genuine fork) or **Hard** (genuinely separate tracks) topologies above.

## Free tower placement

Towers are placed at **arbitrary positions** on the board — this **is** the free placement
of a Bloons-style tower defense, **not** a snap-to-grid and **not** a fixed handful of
nodes. A tower occupies a small round **footprint** centered where the player drops it, and
sits exactly at the point placed.

The only restrictions on *where* are the paths and the other towers:

- **Off the paths.** A tower's footprint may **not overlap any path** — a tower may not sit
  on the track (of any lane) or on an inlet or collector. There is a small clearance beyond
  the visible channel so a tower reads as clearly *beside* the path, not on it. The paths
  are fixed and towers never reroute them; there is **no maze-building**.
- **No overlap.** A tower's footprint may **not overlap another tower's** footprint — two
  towers cannot occupy the same spot.
- **In bounds.** The whole footprint must lie within the board region.

**Any point satisfying all three is buildable.** The player chooses freely where along a
path to build and how densely to pack towers between the paths; the constraint is only the
paths and the footprints, not a lattice. While a tower is **held** for placement, its ghost
follows the pointer, its **range** is previewed as a ring, and an **illegal** spot — on a
path, overlapping a tower, out of bounds, or unaffordable — is clearly **refused**
(`specs/controls.md`).

Coverage — not just density — is what the board rewards, and it now falls out of *where*
you drop each tower over the map's paths:

- A tower **beside one lane only** reaches the units on that lane while they travel it, and
  not another separate lane.
- A tower beside a **shared stretch** (a branching map's inlet approach or shared final
  run) reaches **both** lanes' traffic — the premium spots, and fewer of them.
- On a **multiple-separate-paths** map, a tower placed **between** two tracks may reach
  both if they run close enough for its **range**, but the separate fronts generally each
  demand their own coverage.

A tower's **range** (`specs/towers.md`) decides how much of the nearby path it actually
reaches; a spot far from every path is legal but reaches nothing.

### Range and targeting

- A tower's **range** is a radius in logical pixels measured from its **placed position**.
  A unit is targetable while the point it occupies on its path lies within that radius.
- By default a tower fires at the in-range unit **furthest along** its path toward the
  collector — the standard "first" target — so it works on the most urgent threat. Each
  damage tower's **targeting priority** is selectable per tower (`first` / `last` /
  `nearest` / `farthest` / `strongest` / `weakest`) from its inspector (`specs/towers.md`,
  `specs/controls.md`). Splash and aura towers differ as noted in `specs/towers.md`.
- A tower fires **automatically** at its fire rate whenever it has a valid target; there
  is no manual trigger. A target is *valid* only if the tower can **see** it (it is not
  inert, or it is revealed, or the tower detects — `specs/matter.md`) **and** the
  tower's **damage type can reach** it (energy cannot touch a heavy). Every damage tower
  is generally useful; the traits, not a per-tower form-lock, decide what a given tower
  can act on (`specs/towers.md`, `specs/matter.md`). A tower with nothing valid in range
  holds fire.
- A damage tower's **head rotates to face its current target**, and each shot is a
  **projectile that travels to the unit and deals its damage on impact** — not an
  instant hitscan — colored by its **damage type** (`specs/towers.md`,
  `specs/assets.md`). The support towers are auras: they neither aim nor fire a
  projectile.
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
  current round's progress or the between-round build-phase countdown, and a clear
  **PAUSED** read while the game is paused in place (`specs/flow.md`, `specs/controls.md`).
- **Global controls** — the game **speed** toggle and its current setting, a **pause**
  toggle that pauses and resumes **in place** (freezing the game without a menu while the
  board stays interactive) and reflects the paused state, and a **mute** toggle
  (`specs/controls.md`, `specs/flow.md`).

## Right build panel

The **right build panel** (`x` in `[1000, 1280]`, `y` in `[56, 720]` —
`specs/overview.md`) is where the player builds and inspects, drawn in code (its small
icons may be produced sprites). It always shows, from top to bottom:

- **The shop** — one entry per tower type (`specs/towers.md`) with its name, cost, and
  icon, disabled when unaffordable. Hovering an entry shows that tower's info (role,
  range, what it targets, and its per-level effects) in the inspector area below.
- **The inspector** — context-sensitive: with a **built tower selected**, it shows that
  tower's type, tier (and chosen **branch**), damage type, live stats, and its
  **upgrade** and **sell** controls — at tier III the upgrade control presents the
  tower's **two branch choices** — plus, for a **damage** tower, a **targeting** control
  that cycles its targeting priority (`specs/towers.md`, `specs/controls.md`); with a
  **shop entry hovered**, it
  shows that tower's info; with **neither**, it shows the **next-round preview** — the
  coming round's types and what each asks of the board (`specs/matter.md`,
  `specs/flow.md`) — so the player can plan for it.
- **The round control** — the **START ROUND** button before the first round and between
  rounds (which also reads the build-phase countdown and pays the early-send bonus when
  pressed early, `specs/flow.md`), and the speed toggle as an alternative to the status
  bar's.

The build panel must always be fully visible (`specs/overview.md`). Everything a player
needs to read the run and act on it — energy, integrity, round, the shop, the selected
tower, and the coming round — must be reachable here without hunting.
