# Caldera — The Holdfast towers

This file defines what you fight with: the four **towers** — Repeater, Mortar,
Lance, Scald — their stats and how each resolves damage, how they acquire targets,
how the **terrain elevation** helps or blocks them, and how **upgrades** work. What
they cost and where the terrain lets you place them is in `specs/build.md`; the
**steam** that powers them is in `specs/fluids.md`; what they shoot at is in
`specs/enemies.md`. Values are world units, `u/s`, seconds, and HP, in the real,
frame-rate-independent simulation time from `specs/overview.md`; all are best-effort
defaults and **tunable**.

A tower fires **only while its steam demand is met** (`specs/fluids.md`): a
**brownout** or a **severed** steam line leaves it dark and silent until supply
returns. A powered tower vents a white steam plume (`specs/overview.md`) so its state
is readable in the world.

## Damage resolution

Three attack mechanics appear; a tower uses one:

- **Hitscan.** The shot lands instantly along the line to the target at the moment of
  firing. It requires **line of sight** (below) and hits within the tower's
  **range**. (Repeater, Lance.)
- **Arcing splash.** A projectile is lobbed on a ballistic arc and detonates where it
  lands, dealing full damage at the impact point and falling off to zero at its
  **blast radius**; every Slag in the radius takes damage scaled by distance. An arc
  can clear a **one-level terrace** or low obstacle between the tower and the target,
  but **not** a full **cliff** (below). (Mortar.)
- **Field.** A persistent area effect centered on a ground cell within range, applying
  its effect every tick to all Slag inside its radius. (Scald.)

## The four towers (base stats — before upgrades)

| Tower | Attack | Damage | Cadence | Range | Steam | Anti-armor |
| --- | --- | --- | --- | --- | --- | --- |
| **Repeater** | hitscan, single-target | `12` | `0.2 s` | `60` | `2 f/s` | no |
| **Mortar** | arcing splash | `60`, blast radius `8` | `1.4 s` | `90` | `3 f/s` | no |
| **Lance** | hitscan, single-target | `130` | `1.6 s` | `130` | `5 f/s` | **yes** (ignores armor) |
| **Scald** | field: slow + burn | `15` dmg/s + `40%` slow, radius `12` | continuous | `70` | `5 f/s` | no |

- **Repeater** — the cheap workhorse. High rate, low per-shot damage; it mows down
  **Runners** and other chaff and chips groups. Weak against armor. Its long, flat
  hitscan line benefits most from **elevation** (below).
- **Mortar** — arcing splash. Slow but hits an area, good against **clustered**
  Runners and against **Sappers** filing along a pipe run. Its arc lets it fire
  **over a one-level terrace** to strike a target on the tread behind it — but a
  **cliff** blocks the arc like anything else.
- **Lance** — the **anti-armor** answer. Long-range, high single-target hitscan that
  **ignores armor entirely** (`specs/enemies.md`), so it is how you kill **Breakers**
  and **Colossi** before they reach the Core. Slow to fire and steam-hungry; it wants
  the **highest vantage** for range and clear line of sight.
- **Scald** — a steam-jet **field** tower: it projects a radius that **slows** Slag by
  `40%` and **burns** them for `15` dmg/s while they are inside. It does little burst,
  but it shines on **chokepoints** — a river crossing or a cliff pass
  (`specs/world.md`) — where the Slag are already funneled and slowed, holding them in
  the kill-zone for the other towers. Steam-hungry.

Together they cover the roster: Repeater → Runner, Lance → Breaker/Colossus, Mortar →
clusters and Sappers, Scald → chokepoint control. **Sappers** are answered by placing
any of these to **cover your network's approaches** (`specs/enemies.md`).

## Targeting

- A tower automatically acquires and fires on Slag within its **range** and (for
  hitscan and arcing) reachable by its shot. It acquires the **nearest** valid target
  by default and holds it until it dies or leaves range/line of sight, rather than
  switching every frame. (You may offer a simple target priority — e.g. nearest, or
  nearest-to-Core — but a sensible default is all that is required.)
- Towers deal damage **only** to the Slag; there is no friendly fire and towers never
  damage terrain or other structures.
- A **dark** (brownout/severed) tower acquires nothing and does not fire
  (`specs/fluids.md`).

## Elevation — vantage and line of sight

The terrain's elevation is a tactical resource, and reading it is the core skill —
which only works because the tilted camera and terraces make elevation legible
(`specs/overview.md`, `specs/world.md`):

- **Vantage (range).** A tower on **higher ground** sees and reaches farther: a
  hitscan tower (**Repeater**, **Lance**) gains about **+`8%` range per elevation
  level** its cell stands **above** its target's cell (a modest bonus, tunable). High
  ground is worth holding.
- **Line of sight.** A hitscan tower needs an **unobstructed line** to its target: a
  **cliff** (`specs/world.md`) or higher terrain between the tower and a Slag unit
  **blocks** the shot — the tower cannot fire through rock, and a unit in the dead
  ground behind a cliff is safe from it. A tower **down in a hollow** has its lines
  cut short by the surrounding walls; a tower **on a ridge** commands the approach.
- The **Mortar**'s arc clears a one-level terrace but not a full cliff (above), so it
  can reach some dead ground a hitscan tower cannot — a real reason to mix towers to
  the terrain.

Placement is therefore a genuine terrain decision (`specs/build.md`): where on the
relief a tower stands changes what it can hit.

## Upgrades

A placed tower can be **upgraded** in place (`specs/build.md`), through **two** levels
above base. Each upgrade level applies (tunable):

- **+`40%` damage** (for the Scald, +40% to its burn dmg/s) and **+`15%` range**
  (and +15% blast/field radius where it has one),
- at a **cost** of about **`75%` of the tower's build cost** per level,
- and **+`1 f/s` steam demand** per level.

So an upgraded tower is markedly stronger but draws more steam and must be fed
(`specs/fluids.md`) — upgrading concentrates firepower where the terrain gives you a
commanding spot, at the price of a heavier steam load. An upgraded tower reads as
upgraded (a visible tier accent or added geometry) and shows its level when selected
(`specs/flow.md`). Only towers upgrade; sources, boilers, and pipes do not.
