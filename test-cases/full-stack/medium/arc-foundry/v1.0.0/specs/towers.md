# Components

## Overview

This file defines the eight component types, the turrets you wall the yard with,
each created by keeping a rolled rock or combining a match (`specs/build.md`): their
firing identities, the ability vocabulary (slow, burn, crit, multishot, aura) that
layers on top of raw damage, the quality ladder that scales them, the full stat
tables for every firing type at every quality, and the combination towers, the
unique, upgradeable turrets you fold a recipe of base components into. It builds on
the tile grid and the uniform footprint in `specs/board.md`, the Load it fires at in
`specs/enemies.md`, the scrap-press build loop (the place-and-reveal stamp, the
one-keep-per-level rule, inert blockers, the quality-combine recipe, the recipe
combine that yields a combination tower, and UPGRADE QUALITY) in `specs/build.md`,
the placing / keeping / combining / targeting controls in `specs/controls.md`, the
economy in `specs/flow.md`, and the produced sprites and electrical effects in
`specs/assets.md`. Ranges are in logical pixels (`specs/board.md`); Charge values
are the unitless money of `specs/flow.md`.

The stat numbers below are fixed for this version; implement them exactly as
written. Equally important is the behavior: eight distinct firing identities (five
that deal damage plainly, two that carry a status, slow and burn, and one
non-firing support aura), the steep quality power curve that makes combining always
pay, the Coil's chain and the Arc-Node's splash, per-component targeting, the
rotating head, the rule that every shot is a traveling projectile that carries its
hit, and the twelve combination towers that a recipe combine assembles from base
parts.

## The eight component types

Each component is a salvaged electrical part with its own firing identity and
signature effect. Every damage or status component fires automatically at a valid
in-range unit (there is no manual trigger), and all firing components hit both
ground and flying units (electricity arcs to anything, so a flyer over the yard is
a legal target, `specs/enemies.md`). A firing component with nothing in range holds
fire. The one exception is the Regulator, which never fires: it is a support node
whose aura buffs the towers around it.

| Type | Role / stance | Signature effect (`specs/assets.md`) |
| --- | --- | --- |
| **Capacitor** | balanced single-target zap — the common workhorse | a crisp blue-white bolt |
| **Coil** | chain-lightning — the hit leaps to nearby extra targets | lightning arcing between units |
| **Emitter** | rapid, very low-damage spark at a high fire rate | a fast spark spray |
| **Arc-Node** | area discharge — damages everything around the impact | an expanding discharge ring |
| **Discharge Rig** | slow, long-range heavy bolt — highest single-hit damage | a fat capacitor-bank crack |
| **Choke** | single-target zap that slows the struck unit — low damage, drags the Load | a cold clamp-arc that grips its target |
| **Rectifier** | single-target zap that lights an overcurrent burn — low direct hit, damage over time | a lingering ember flare on the target |
| **Regulator** | support aura — never fires; boosts the damage of every firing tower in range | a steady support pulse ring (no bolt) |

A component is never bought at a chosen type or quality: it is created only by
keeping a rolled candidate, by combining a same-type/same-quality match up the
quality ladder, or, for a combination tower, by a recipe combine that folds a whole
multiset of base components into one unique turret (`specs/build.md`, and
Combination towers below). What you build with is what the press hands you, one keep
per level, so the roster is played by shaping random rolls (and refining the press
to roll better ones), not by picking towers off a shop.

## The ability vocabulary

Beyond raw damage, components and combination towers carry abilities. There is
still no armor or damage-type system: every unit takes HP loss the same way
(`specs/enemies.md`); an ability only ever modifies a unit's speed (slow) or applies
extra HP loss (burn), or multiplies a shot (crit), fans it across targets
(multishot), or buffs a nearby tower's damage (aura). The full vocabulary, applied
exactly as written:

- slow: on hit, the struck unit's speed is scaled by a slow factor for a duration.
  A slow of amount `amt` sets the unit's `slowFactor = min(current, 1 − amt)` and
  its `slowUntil = now + duration`; while active the unit moves at `baseSpeed ×
  slowFactor`. Slows do not stack (the strongest slow in effect wins) but any fresh
  hit refreshes the duration. Carried by the Choke base type and several combos.
- burn: on hit, the target gains (or refreshes) an overcurrent burn, a
  damage-over-time with `burnDps = shotDamage × frac` that ticks HP loss every sim
  step until `burnUntil = now + duration`. Multiple burn sources do not stack into
  an ever-growing total: the target keeps the strongest `burnDps` and refreshes the
  duration. Burn damage is attributed to the tower that applied it for the kill and
  DMG-dealt tallies (`specs/flow.md`). Carried by the Rectifier base type and
  several combos.
- crit (combination towers only): each shot has a crit chance to deal `× critMult`
  damage instead of its base damage; the roll comes off the simulation RNG and a
  crit shows a bigger impact effect (`specs/assets.md`). No base component ever
  crits.
- multishot (combination towers only): instead of one target per cadence, the tower
  fires at up to N distinct in-range targets each cadence, each a separate traveling
  projectile, choosing the top N by its targeting priority (then next-best). No base
  component multishots.
- aura (the Regulator base type and some combos): a passive field of radius
  `auraRadius`: any firing tower whose center lies within that radius has its damage
  multiplied by `(1 + auraBonus)`. Multiple auras covering one tower sum their
  bonuses, capped at +100%. An aura is recomputed whenever structures change; the
  aura source itself is unaffected (a Regulator does not fire, and a combo's own
  aura does not buff itself). Aura is a pure damage buff; it never changes range,
  cadence, or an ability's numbers.

## The quality ladder

Every base component carries a quality tier on a five-rung ladder from crude
salvage to a pristine artifact. Quality is the power axis: it multiplies damage,
nudges range, and steps up each type's signature numbers, and it must read at a
glance (sprite finish and effect intensity escalate every rung, `specs/assets.md`),
so a board of Scrap looks like a junkyard and a Tesla-Prime looks like a lightning
god.

| Tier | Quality | Reads as |
| --- | --- | --- |
| **T1** | **Scrap** | pitted, rusted, a dim flicker |
| **T2** | **Tuned** | cleaned, a steady glow |
| **T3** | **Charged** | polished, bright, humming |
| **T4** | **Primed** | machined, arcing at rest |
| **T5** | **Tesla-Prime** | mirror-chromed, wreathed in continuous arcs |

The quality-tier names are deliberately distinct from the component-type names so
the two axes never collide: a base component is always a type (what it does) at a
quality (how hard). You climb the ladder by combining two matching components (same
type and same quality) into one a tier higher, and by refining the press (UPGRADE
QUALITY) so it rolls higher tiers to begin with; the recipes, odds, and the
free-of-Charge combine climb live in `specs/build.md`. Combination towers, below,
are the exception: they have no quality tier.

## How quality scales a component

A base component's stats derive from its base (Scrap / T1) stats and its quality
tier, by these fixed rules:

- Damage = base damage × quality multiplier: T1 `×1`, T2 `×3`, T3 `×9`, T4 `×40`, T5
  `×110`. The curve is deliberately steep so combining two components always
  out-damages the two it consumed (`specs/build.md`), and because the press rolls
  Primed (T4) and Tesla-Prime (T5) only at high Refinement and only rarely
  (`specs/build.md`: UPGRADE QUALITY), the board's power comes mostly from climbing,
  not from flooding the yard with Scrap.
- Range = base range + 8 px per tier above T1 (so T3 is `+16`, T5 is `+32`).
- Fire rate is flat across quality: a component's firing cadence is part of its
  identity and never changes with tier. Quality is the power axis, cadence is the
  identity axis.
- Footprint is the uniform 2×2 tiles (40×40 px) at every quality (`specs/board.md`);
  there are no size variants. This holds for the non-firing Regulator too: it is a
  2×2 wall like every other structure.
- Signature numbers step up with quality per type: the Coil's chain length, the
  Arc-Node's splash radius, the Choke's slow amount, and the Regulator's aura radius
  and bonus (all below). The Rectifier's burn fraction is flat, but because `burnDps
  = shotDamage × frac` and shot damage climbs with the multiplier, the burn scales
  with tier all the same.

The Regulator has no damage or range (it does not fire), so the multiplier and range
rules do not apply to it; quality instead scales its aura radius and bonus (the
Regulator aura table below).

## Shared firing and targeting rules

These apply to every firing component, the seven damage/status types and all twelve
combination towers. The Regulator is excluded from all of them: it has no range ring
for targeting, no head, no projectile, and no targeting priority (its aura geometry
is its only reach).

- Range is a radius in logical pixels measured from the center of the 2×2 footprint
  (`specs/board.md`); a unit whose position is within that radius is targetable,
  ground or flying.
- Each firing component fires at its fire rate (shots per second) whenever it has a
  valid in-range target, and holds fire otherwise.
- Every firing component carries a targeting priority, chosen by the player and
  changed at any time from the selected-component inspector (`specs/controls.md`).
  Every firing component defaults to `first`. The five priorities:
  - `first`: the in-range unit furthest along the waypoint chain (the unit nearest to
    grounding out at the collector; progress is measured as waypoint index reached,
    then remaining path length to the next waypoint, `specs/board.md`). The default.
  - `last`: the in-range unit least far along the chain (nearest the entry).
  - `nearest`: the in-range unit at the shortest straight-line distance from the
    component's own center.
  - `strongest`: the in-range unit with the most remaining hit points.
  - `weakest`: the in-range unit with the fewest remaining hit points.
  - Ties resolve toward the unit furthest along the chain, so a component's choice is
    deterministic. Changing priority is free and takes effect immediately.
- The Coil and the Arc-Node (and any combo with chain or splash) pick their primary
  target by this priority exactly like the others, then chain / splash around that
  primary (below). A multishot combo picks its top N targets by the same priority.
- Firing components aim. A firing component's head rotates to face the unit it is
  firing at and keeps its last heading while it holds fire. The sprite is authored as
  a rotatable head over a fixed base, drawn facing one canonical direction so the
  game turns it to aim (`specs/assets.md`). The Regulator, having no head or fire
  cycle, does not rotate; it renders as a steady support node (`specs/assets.md`).
- A shot is a real projectile, and the projectile carries the hit. When a component
  fires it launches a visible traveling bolt / arc from its head toward the target;
  the projectile travels and applies the damage, and any slow or burn, on impact,
  never before. Hitscan does not satisfy this. If the target dies or leaves before
  the projectile arrives, the shot misses. This travel is where the electrical
  effects live (`specs/assets.md`).
- Each firing component's info, in the selected-component inspector
  (`specs/board.md`), reads its type (or combo name), its quality tier (base
  components only), its live stats (damage, range, fire rate, targeting), and any
  abilities it carries, and all of them read as hitting ground and air. The
  Regulator's inspector shows its aura radius and bonus in place of damage / range /
  fire rate.

## Base (Scrap / T1) stats

These are the base numbers every higher tier scales from (per the rules above). Type
order is Capacitor, Coil, Emitter, Arc-Node, Discharge Rig, Choke, Rectifier,
Regulator.

| Type | Range | Fire rate | Base dmg (T1) | Firing behavior |
| --- | --- | --- | --- | --- |
| **Capacitor** | 100 | 1.6 /s | 6 | single target |
| **Coil** | 110 | 1.0 /s | 5 | chains to nearby extra targets (below) |
| **Emitter** | 88 | 4.5 /s | 2 | single target, very fast |
| **Arc-Node** | 96 | 0.85 /s | 5 | splash: all units within radius of impact (below) |
| **Discharge Rig** | 160 | 0.5 /s | 18 | single target, long range |
| **Choke** | 104 | 1.3 /s | 3 | single target + slow on hit (below) |
| **Rectifier** | 96 | 1.1 /s | 2 | single target + burn on hit (below) |
| **Regulator** | — | — | 0 | does not fire — aura only (below) |

- Capacitor: a balanced single-target bolt at a steady cadence, medium range and
  damage.
- Emitter: the fastest firer at the lowest per-shot damage, at short range (the fast
  spark spray, `specs/assets.md`).
- Discharge Rig: a big single bolt on a slow cadence, the highest per-shot damage
  and the longest reach.
- Choke: a single-target bolt that, on hit, slows the struck unit for a moment. Low
  direct damage (the Choke — slow subsection below).
- Rectifier: a single-target bolt that, on hit, lights an overcurrent burn, a
  damage-over-time that keeps ticking after the shot. Low direct damage (the
  Rectifier — burn subsection below).
- Regulator: a non-firing support node: every firing tower whose center is inside
  its aura deals more damage. It has no damage, range, or targeting; it still
  occupies a 2×2 footprint, still walls the yard, and is still a keepable candidate
  and a combine ingredient (the Regulator — aura subsection below).

### Coil — chain-lightning

The Coil's bolt hits its primary target, then leaps to the nearest not-yet-hit unit
within `70 px` of the last unit struck, and again from there, forking through the
pack. Each leap deals `×0.7` of the previous leap's damage (the primary hit is full
damage; the first leap `×0.7`, the second `×0.49`, and so on), so the chain dims per
jump (mirror this in the effect, `specs/assets.md`). The maximum number of
additional leaps grows with quality:

| Quality | T1 Scrap | T2 Tuned | T3 Charged | T4 Primed | T5 Tesla-Prime |
| --- | --- | --- | --- | --- | --- |
| **Additional leaps** | 2 | 2 | 3 | 3 | 4 |

A leap that finds no un-hit unit within `70 px` ends the chain early.

### Arc-Node — area discharge

The Arc-Node picks a primary target by its priority, and its shot discharges at the
impact point, dealing its full damage to every unit (ground or flying) within the
splash radius of that point. The radius grows with quality (`T1 42 px`, `+5 px` per
tier):

| Quality | T1 Scrap | T2 Tuned | T3 Charged | T4 Primed | T5 Tesla-Prime |
| --- | --- | --- | --- | --- | --- |
| **Splash radius (px)** | 42 | 47 | 52 | 57 | 62 |

Splash is flat full damage inside the radius (no falloff).

### Choke — slow

The Choke fires a single-target bolt for its (low) damage and, on impact, applies a
slow to the struck unit: its speed is scaled to `1 − amt` for `1.2 s`, refreshed on
every fresh hit (the slow rules under The ability vocabulary). The slow amount grows
with quality (`amt = 0.22 + 0.03·(tier − 1)`):

| Quality | T1 Scrap | T2 Tuned | T3 Charged | T4 Primed | T5 Tesla-Prime |
| --- | --- | --- | --- | --- | --- |
| **Slow amount** | 0.22 | 0.25 | 0.28 | 0.31 | 0.34 |
| **Speed while slowed** | ×0.78 | ×0.75 | ×0.72 | ×0.69 | ×0.66 |

A Choke deals little damage; its effect is the slow it applies, which keeps a unit in
the maze longer.

### Rectifier — burn

The Rectifier fires a single-target bolt for its (low) damage and, on impact, lights
an overcurrent burn on the struck unit: `burnDps = shotDamage × 0.5` ticking for
`2.0 s`, refreshed on every hit, keeping the strongest `burnDps` (the burn rules
under The ability vocabulary). The burn fraction is flat 0.5 at every tier, but
because the shot damage climbs with the quality multiplier, the burn scales with the
Rectifier's tier. Burn damage is credited to the Rectifier that applied it
(`specs/flow.md`). A Rectifier's direct hit is tiny; its damage comes from the burn
ticking between its shots.

### Regulator — aura

The Regulator does not fire. It projects an aura (the aura rules under The ability
vocabulary): every firing tower whose center lies within `auraRadius` deals `× (1 +
auraBonus)` damage. Both grow with quality (`radius = 90 + 6·(tier − 1)`, `bonus =
0.10 + 0.03·(tier − 1)`):

| Quality | T1 Scrap | T2 Tuned | T3 Charged | T4 Primed | T5 Tesla-Prime |
| --- | --- | --- | --- | --- | --- |
| **Aura radius (px)** | 90 | 96 | 102 | 108 | 114 |
| **Damage bonus** | +10% | +13% | +16% | +19% | +22% |

The Regulator lifts the damage of every firing tower whose center falls inside its
aura at once. It still walls the yard, still can be kept, and is a required
ingredient in several combination towers (below). Auras from multiple Regulators (or
aura combos) sum on a covered tower, capped at +100%.

## Full damage table (type × quality)

Damage per shot, `base × qualityMult` with `qualityMult = [1, 3, 9, 40, 110]`,
rounded, fixed. The Regulator has no damage row (it does not fire; see its aura
table above):

| Type | Scrap (T1) | Tuned (T2) | Charged (T3) | Primed (T4) | Tesla-Prime (T5) |
| --- | --- | --- | --- | --- | --- |
| **Capacitor** | 6 | 18 | 54 | 240 | 660 |
| **Coil** | 5 | 15 | 45 | 200 | 550 |
| **Emitter** | 2 | 6 | 18 | 80 | 220 |
| **Arc-Node** | 5 | 15 | 45 | 200 | 550 |
| **Discharge Rig** | 18 | 54 | 162 | 720 | 1980 |
| **Choke** | 3 | 9 | 27 | 120 | 330 |
| **Rectifier** | 2 | 6 | 18 | 80 | 220 |

(For the Coil, this is the primary-hit damage; each leap is `×0.7` of the previous,
per above. For the Arc-Node, this is dealt to every unit in the splash radius. For
the Choke and Rectifier, this is the direct hit; the slow / burn is applied on top
per the subsections above, and a Rectifier's `burnDps` is half this figure per
second.)

## Full range table (type × quality)

Range in logical pixels, `base + 8·(tier − 1)`, fixed. The Regulator has no range row
(its reach is its aura radius, tabled above):

| Type | T1 | T2 | T3 | T4 | T5 |
| --- | --- | --- | --- | --- | --- |
| **Capacitor** | 100 | 108 | 116 | 124 | 132 |
| **Coil** | 110 | 118 | 126 | 134 | 142 |
| **Emitter** | 88 | 96 | 104 | 112 | 120 |
| **Arc-Node** | 96 | 104 | 112 | 120 | 128 |
| **Discharge Rig** | 160 | 168 | 176 | 184 | 192 |
| **Choke** | 104 | 112 | 120 | 128 | 136 |
| **Rectifier** | 96 | 104 | 112 | 120 | 128 |

## Combination towers

Beyond climbing the quality ladder, the game's headline power move is the
combination tower: a unique, named turret you assemble from a recipe of base
components. This is the single biggest source of firepower on the board, and,
because the recipes reach up to Tesla-Prime ingredients, the deepest chase in the
run.

### What a recipe combine is

A recipe combine is an immediate action (full mechanic in `specs/build.md`). You
select a base structure and, when the board (candidates plus existing base
components) contains the exact multiset of base `(type, quality)` ingredients a combo
recipe demands including the selected initiator, the inspector offers `COMBINE →
<combo>`. Committing it resolves at once:

- The combination tower lands at the initiating piece's footprint (so it may replace
  a standing tower).
- Every consumed ingredient footprint hardens into a blocker, wall-neutral, exactly
  like a quality-combine, so a recipe combine never opens a hole in the maze
  (`specs/board.md`, `specs/build.md`).
- Its ingredients decide whether it is the harvest (`specs/build.md`): a recipe that
  folds in `≥1` fresh candidate is the level's one harvest and sends the wave
  (including the one-shot where every ingredient was placed this phase); a recipe of
  only standing towers is a plain COMBINE, taken at will in the build phase and
  during a live wave, that does not send the wave.

### Combination towers land weak and are UPGRADED (levels 0–3)

A combination tower has no quality tier. Instead it carries an upgrade level on a
four-rung track `0 … 3`, and reads on the board as a special gold-accented turret:

- A recipe combine lands the combo at level 0, a reduced fraction of its reference
  stat block (the Combo level scaling table below). This softens the power spike of
  landing a combo.
- UPGRADE raises the level for Charge (`specs/build.md`), up to level 3, scaling its
  damage and range back up and slightly past the reference, a Charge sink and a
  smoother power curve. Upgrading is allowed in any phase, including during a live
  wave (like combining standing towers and UPGRADE QUALITY), so kill income can be
  poured into the firing line the instant it lands.
- It cannot be quality-combined (there is no matching tier to climb into), cannot be
  used as an ingredient in another recipe combine (it is not a base structure), and
  is never a combine ingredient (fold a fresh roll into a base tower, not a combo,
  `specs/build.md`).
- It still fires and walls like any component, and it still benefits from external
  auras: a Regulator or aura combo covering it lifts its damage per the aura rules
  (capped +100%).

### The twelve combination towers (reference stat blocks)

The table below is each combo's reference stat block, the numbers at a "full" combo.
A landed combo is scaled from these by its upgrade level (the Combo level scaling
table after it). Recipe tier codes: `1` Scrap, `2` Tuned, `3` Charged, `4` Primed,
`5` Tesla-Prime. Ability notation: `splash(radius)`, `chain(leaps, leapRange,
falloff)`, `slow(amt, dur)`, `burn(frac, dur)`, `crit(chance, mult)`,
`multishot(N)`, `aura(radius, bonus)`. The recipes and abilities are fixed;
implement each combo exactly.

| # | Combo (id) | Recipe (type@tier) | Range | Rate /s | Damage | Abilities |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Fuse Cluster** (fusecluster) | Regulator@1 + Rectifier@1 + Arc-Node@1 | 108 | 1.0 | 40 | splash(55), burn(0.4, 2.0) |
| 2 | **Static Web** (staticweb) | Coil@1 + Capacitor@1 + Choke@1 | 120 | 1.2 | 34 | chain(3, 80, 0.75), slow(0.25, 1.2) |
| 3 | **Slag Driver** (slagdriver) | Discharge Rig@2 + Discharge Rig@1 + Emitter@1 | 175 | 0.6 | 120 | crit(0.25, 2.0) |
| 4 | **Corroder** (corroder) | Rectifier@3 + Regulator@3 + Choke@2 | 110 | 1.1 | 40 | burn(0.6, 3.0), slow(0.2, 1.0), aura(80, +10%) |
| 5 | **Ion Prism** (ionprism) | Discharge Rig@3 + Rectifier@4 + Emitter@2 | 140 | 0.9 | 220 | splash(50), burn(0.5, 2.0), crit(0.2, 1.8) |
| 6 | **Fork Array** (forkarray) | Emitter@3 + Capacitor@3 + Coil@2 | 118 | 1.8 | 100 | multishot(3) |
| 7 | **Null Core** (nullcore) | Regulator@5 + Capacitor@4 + Arc-Node@3 | 120 | 1.0 | 420 | splash(55), aura(100, +20%) |
| 8 | **Rupture Node** (rupturenode) | Discharge Rig@5 + Arc-Node@4 + Emitter@3 | 150 | 0.7 | 1770 | splash(60), burn(0.5, 2.0) |
| 9 | **Blight Coil** (blightcoil) | Rectifier@5 + Choke@4 + Coil@2 | 128 | 1.1 | 375 | chain(3, 80, 0.7), burn(0.6, 3.0), slow(0.3, 1.5) |
| 10 | **Reactor Pile** (reactorpile) | Coil@5 + Choke@3 + Regulator@2 | 130 | 1.4 | 420 | chain(4, 85, 0.75), multishot(2) |
| 11 | **Aurora Lance** (auroralance) | Choke@5 + Coil@4 + Discharge Rig@4 | 190 | 0.7 | 1980 | chain(2, 75, 0.6), slow(0.4, 1.8) |
| 12 | **Singularity** (singularity) | Arc-Node@5 + Regulator@4 + Rectifier@2 + Arc-Node@2 | 150 | 1.0 | 490 | splash(65), burn(0.6, 2.5), crit(0.3, 2.2), aura(90, +15%) |

#### Combo level scaling

A landed combo's live stats derive from its reference block (above) and its upgrade
level by these fixed rules; fire rate and every ability parameter (splash radius,
chain leaps, slow/burn/crit numbers, aura) are flat across level. Only damage and
range change, and because every ability is damage-derived, the whole combo scales
through its damage:

- Damage = reference damage × level multiplier: level 0 `×0.5`, level 1 `×0.63`,
  level 2 `×0.78`, level 3 `×1.02`. So a combo lands at half its reference and climbs
  to slightly past it at level 3.
- Range = reference range + per-level bonus: `+0 / +4 / +8 / +12` px at levels `0 / 1
  / 2 / 3`.
- Upgrade cost to reach each level is a fraction of the combo's reference damage:
  `×0.8` for level 1, `×1.5` for level 2, `×2.8` for level 3, rounded, so a stronger
  combo is a deeper Charge sink.

Inspector one-liners, describing what the combo does, not how to use it:

- Fuse Cluster: a splash bolt that also burns what it hits.
- Static Web: a chaining bolt that slows every unit it forks through.
- Slag Driver: a long-range heavy bolt that can land a critical hit.
- Corroder: burns and slows what it hits, and projects a damage aura over nearby
  towers.
- Ion Prism: a splash bolt that burns on impact and can crit.
- Fork Array: fires at three separate targets at once.
- Null Core: a splash core wrapped in a strong damage aura.
- Rupture Node: a heavy shot that detonates a large burning splash.
- Blight Coil: a chaining bolt that both slows and burns everything it forks through.
- Reactor Pile: fires two heavy chain-lightning bolts at once.
- Aurora Lance: enormous reach and per-hit damage, a hard slow, and a chaining
  strike.
- Singularity: splash, burn, critical hits, and a damage aura in one tower.

### Recipes gate the whole run

The recipe tier spread runs from all-Scrap early combos (Fuse Cluster, Static Web,
reachable around the early waves off cheap rolls) through mid combos needing Charged
/ Primed ingredients, to a Tesla-Prime-gated apex (Aurora Lance, Blight Coil,
Reactor Pile, Singularity). Because the press rolls Primed (T4) and Tesla-Prime (T5)
only at high Refinement and only rarely (`specs/build.md`), the apex combos demand
that you have climbed several base components up the quality ladder (or refined the
press hard and gotten lucky) just to hold their ingredients. That makes combining a
gate throughout the run (there is a combo to reach at almost every stage), and the
apex combos a deep chase that only a run that has climbed hard can assemble. A run
that keeps and refines but never assembles a combination tower falls short of what
the late waves demand.

## Cost and permanence (no selling)

A component is created only by keeping a rolled candidate, by combining a
same-type/same-quality match up the quality ladder, or by a recipe combine into a
combination tower (`specs/build.md`); it is never bought at a chosen quality.
Stamping rocks is free (capped at five per level). What you spend Charge on is
UPGRADE QUALITY and upgrading combination towers (`specs/build.md`), not on the
components themselves. Placing, combining, and downgrading are free; only combo
upgrades cost Charge.

- There is no selling: nothing you place is ever refunded for Charge. A rock you do
  not keep hardens into an inert blocker at wave start and stays part of the maze for
  the rest of the run (`specs/build.md`). Both a quality-combine and a recipe combine
  consume their ingredients, but each consumed footprint hardens into a blocker
  rather than being freed, so no combine ever opens a hole in the maze
  (`specs/board.md`, `specs/towers.md`). Combination towers and Regulator auras
  change none of this: they add no refund and free no tile.
- You may dismantle a misplaced structure, but only in the build phase (between
  waves), and it is a correction tool, not a sale: selecting a rock, blocker, or
  component (including a combination tower) and dismantling it clears its 2×2
  footprint (the floor re-paths live) and returns nothing, no stamp, ever, including
  for a candidate you just placed this phase. A dismantled roll is spent for good.
  There is no mid-wave removal.
- You may downgrade a candidate, a KEEP one tier lower that harvests it as a firing
  component at the reduced tier and sends the wave (`specs/build.md`), free, no
  refund, purely to stand up the low-tier `(type, quality)` a recipe needs when the
  press has rolled too high; fold it into the recipe with a standing COMBINE during
  the wave. It applies only to this level's fresh rolls (not standing components).
- The steep damage curve is why combining always pays: two matching components fold
  into one that out-damages them both at no Charge, while the maze is unchanged (the
  partner's footprint stays a wall). A recipe combine goes further: it trades a whole
  multiset of parts for a unique turret the ladder cannot produce (which then lands
  weak and is upgraded with Charge). Combining is immediate; the questions are
  whether you rolled (or climbed to) the ingredients, and which pieces you fold.
  Spending a fresh roll makes it the level's one harvest and sends the wave (this is
  what KEEP also does), while folding only standing towers keeps the phase
  open and is the combine you also use mid-wave (`specs/build.md`, `specs/board.md`).

Keeping, combining, downgrading, upgrading combos, upgrading quality, and
setting targeting all happen through the selected-candidate / component inspector and
the scrap-press in the build panel (`specs/controls.md`).
