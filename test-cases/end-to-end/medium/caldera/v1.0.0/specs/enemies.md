# Caldera — The Slag: roster, tiers, and AI

This file defines what you fight: the **Slag** roster (Runner, Breaker, Sapper,
Colossus), how tough each is across its **tiers**, and how the Slag **pathfind**
across the terrain and choose what to attack. Which archetypes and tiers actually
spawn, and when, is the escalation schedule in `specs/waves.md`. What they path
over is the terrain in `specs/world.md`; what they attack is the Core
(`specs/world.md`) and your network and towers (`specs/build.md`, `specs/fluids.md`,
`specs/towers.md`). Values are world units, `u/s`, seconds, and HP, in the real,
frame-rate-independent simulation time from `specs/overview.md`.

## What the Slag are

The Slag are an obsidian corruption that wells up through the two rim **breaches**
(`specs/world.md`) and grinds toward the Core. They are drawn as blocky obsidian
geometry with an **acid-green** glow (`specs/overview.md`), each reading as the
silhouette below, with a dark outline so it reads against the terrain. There is **no
friendly fire and no player avatar** — the Slag fight your **structures** (the Core,
pipes, sources, boilers, towers), and your **towers** fight the Slag; that is the
whole combat.

## Pathfinding in 3D — over the terrain

Every Slag unit navigates the hex terrain in three dimensions. This is a core
requirement, not a nicety. The terrain is **non-destructible** (`specs/world.md`), so
it can be treated as static for planning, but the field is dynamic in the units and
structures on it.

- Units path across the terrain surface toward their target, over **flat** and
  **terraced** edges — up and down terraces, around hills — **without** walking
  through solid terrain, up cliff faces, or off the grid edge.
- **Cliffs** (`d ≥ 2`, `specs/world.md`) are **impassable walls**: units route
  **around** them. **Deep water** (`specs/world.md`) is **impassable**: units never
  enter it and route around it. These two are what funnel the assault into lanes.
- **Rivers are wade-slow:** a unit may cross a river (shallow-water) cell but moves
  at about **half speed** while on it, wading with a visible splash. Rivers are
  therefore natural slowing kill-zones, not walls — there are **no** dedicated
  crossings to build or defend; any river cell is a slow crossing.
- A unit that cannot reach its current target does not freeze or jitter: it advances
  to the reachable-most point (and, for network-cutters, re-targets — below). Apply
  simple **local avoidance** so a crowd **flows and spreads** around cliffs, water,
  towers, and the Core rather than stacking into a vibrating pile or a single-file
  line.
- Two breaches feed the field, so the Slag press from **two directions**; they
  spread across each approach as they advance. Pathing must stay cheap enough to run
  the whole live population at the required frame rate (`specs/overview.md`); how you
  keep it cheap is your choice.

## The roster

The Slag field a **small set of archetypes**, each with a fixed intent. Base stats
are for **Tier I**; tiers multiply them (below).

| Archetype | Role & target | HP | Armor | Attack | Speed |
| --- | --- | --- | --- | --- | --- |
| **Runner** | Fast, fragile chaff; beelines the **Core**, swarming in numbers. | `50` | none | Melee `8` dmg to the Core, `0.7 s` cadence, reach `2` | `8 u/s` |
| **Breaker** | Heavily armored sapper; beelines the **Core** and grinds its health down. The primary Core-killer. Slow. | `260` | heavy | Melee `45` dmg to the Core, `1.4 s` cadence, reach `2.5` | `4 u/s` |
| **Sapper** | Targets your **fluid network** — it ignores the Core and towers unless blocked, and marches to cut **pipes, sources, and boilers**. | `90` | light | Melee `30` dmg to a structure, `1.0 s` cadence, reach `2` | `6 u/s` |
| **Colossus** | Massive elite bruiser; wades to the **Core** dealing huge damage and buffs nearby Slag (armor aura, below). Very slow, very durable. | `600` | heavy | Melee `90` dmg to the Core, `1.6 s` cadence, reach `3` | `3 u/s` |

### Behaviors and targeting

- **Runners** path by the most direct reachable route to the **Core** and attack it.
  Cheap and fast; they punish any gap in your coverage.
- **Breakers** path to the **Core** and attack it until it or they are destroyed.
  They are the clock on the Core — heavily armored, so they demand **anti-armor**
  fire (the Lance, `specs/towers.md`) or concentrated fire to bring down before they
  arrive. They do not detour for towers or pipes.
- **Sappers** path to the **nearest reachable Holdfast structure that is not the
  Core** — a pipe, source, boiler, or tower — and destroy it, then re-target the next
  nearest, working inward. A Sapper cutting a trunk **water main** can black out a
  whole flank (`specs/fluids.md`), so Sappers are stopped not by a special counter
  but by **covering your network's approaches with towers** — a Sapper dies walking
  past them. If no reachable structure remains, a Sapper falls back to attacking the
  Core.
- **Colossi** path to the **Core** like Breakers but are far tougher and hit far
  harder, and project an **armor aura**: every Slag within about **`12` units** of a
  Colossus gains **+`20%` damage reduction** while in the aura (it does not stack
  across multiple Colossi — take the strongest). A Colossus is the late-wave
  headliner and demands focused anti-armor fire.

The AI does **not** cheat: units have exactly the stats here and no more, and they
must be **killable** — a competent, well-supplied defense thins each wave, and the
escalation in `specs/waves.md` (not any hidden buff) is what makes the late waves
hard. The Slag should read as a coordinated tide from both breaches, not a single-
file line.

## Tiers — the quality ramp

Every archetype comes in three **tiers**. A tier is the **same model re-plated** in
a tier accent (`specs/overview.md`) — Tier I plain obsidian, Tier II steel
**plating**, Tier III bright violet elite **trim** — each tougher, better-armored,
and hitting harder. **There is one provided model per archetype and no more**: each
ships with an **accent region** (its plates and trim) authored in the reserved accent
color, and you produce a tier by **recoloring that region** — Tier I obsidian, Tier II
steel, Tier III violet — leaving the body and the acid glow untouched. The exact
recolor procedure is in `specs/assets.md`. **You do not author geometry per tier, and
you do not tint the whole model.** Which tier a spawning unit rolls is set by the wave
schedule (`specs/waves.md`), not by anything here.

Apply these multipliers to each archetype's Tier I base stats:

| Tier | HP | Damage | Armor |
| --- | --- | --- | --- |
| **I** | ×`1.0` | ×`1.0` | as listed |
| **II** | ×`1.8` | ×`1.4` | +`25%` damage reduction |
| **III** | ×`2.8` | ×`1.9` | +`40%` damage reduction |

- **Armor** reduces incoming tower damage by the listed percentage — **except** from
  **anti-armor** sources, which **ignore armor entirely**: the **Lance**
  (`specs/towers.md`). This is what makes the Lance matter as the tiers climb;
  ordinary towers still hurt armored Slag but pay the armor tax on Tier II/III.
- A Colossus's **aura** (+20%) stacks on top of its own tier armor for nearby Slag,
  so an escorted late-wave push is genuinely durable — anti-armor fire is the answer.
- Breakers and Colossi are the toughest things on the field for their tier; a Tier
  III Breaker should genuinely require focus or anti-armor fire to kill before it
  reaches the Core.

## Damage, death, and the Core

- A Slag unit reaching its target attacks on its cadence: the Core takes damage to
  its health pool (`specs/world.md`); a structure takes damage to its pool
  (`specs/build.md`), and at `0` is destroyed and its line breaks (`specs/fluids.md`).
- A Slag unit at `0` HP is **destroyed** (a brief blocky break-apart or fade) and
  increments the run's **kill count** (`specs/waves.md`). Destroyed units deal no
  more damage and drop **nothing** — there are no pickups or bounties
  (`specs/build.md`).
- Slag never damage terrain (`specs/world.md`) and never damage each other.

The Core's health trends down whenever Slag reach it, and the run is lost if it hits
`0` (`specs/waves.md`) — but unlike a pure-survival siege, a well-built, well-supplied
defense can stop enough Slag short of the Core to **hold** through the final wave and
win (`specs/waves.md`).
