# Valence — Towers

This file defines the seven towers (five that deal damage and two that support),
their stats, their damage types, their detection, and the two-branch upgrade
choice each offers. It builds on the board and its free tower placement in
`specs/board.md`, the hit points / damage-type / trait model in
`specs/matter.md`, the controls in `specs/controls.md`, and the economy in
`specs/gameplay.md`. Ranges are in logical pixels; costs and energy are the
unitless values of `specs/gameplay.md`.

The stat numbers below are fixed; implement them exactly as written. Equally
important is the behavior: no tower is a lock for one form, no capability is
monopolized, and each tower offers a real identity choice at tier III.

## The design in one paragraph

Every damage tower is generally useful: it deals one of three damage types and
can chip almost anything (`specs/matter.md`). The special capabilities are
shared, not owned: heavy matter is answered by any kinetic or nuclear tower
(Cleaver, Reactor, or a Beam's Disruptor), bonded matter is chipped by any tower
(kinetic just does it fastest), and detection of inert matter comes from four
sources (the Catalyst aura, the Reactor's Fallout zone, the Ionizer's Array
branch, and the Beam natively). And each tower reaches tier III by committing to
one of two branches, so a board is a set of genuine choices, not a fixed
checklist.

## Shared targeting rules

- A tower is placed freely on the board (`specs/board.md`), anywhere off the
  paths and not overlapping another tower, and reaches units on the paths within
  its range (a radius from its placed position). Towers cannot overlap.
- The five damage towers fire at their fire rate (shots per second) at a valid
  in-range unit. A unit is valid only if the tower can see it (it is not inert,
  or it is revealed, or the tower detects) and the tower's damage type can reach
  it (energy cannot touch a heavy, `specs/matter.md`). Among its valid in-range
  units the tower chooses one by its targeting priority (below). A tower with
  nothing valid in range holds fire.

### Targeting priority (per tower)

- Each damage tower carries its own targeting priority, chosen by the player and
  changed at any time from the selected-tower inspector (`specs/controls.md`).
  It decides which valid in-range unit the tower fires at (and, for a
  multi-target volley like the Emitter's Spread branch, the order in which the
  top targets are picked). Every tower defaults to `first`. The six priorities:
  - `first`, the valid unit furthest along the conduit (closest to the
    collector). The default.
  - `last`, the valid unit least far along the conduit (nearest the inlet).
  - `nearest`, the valid unit at the shortest straight-line distance from the
    tower's own placed position (independent of path progress).
  - `farthest`, the valid unit at the greatest straight-line distance from the
    tower, still within range.
  - `strongest`, the valid unit with the most remaining hit points (a bonded
    cluster counts its outstanding bond pool plus the atoms it has yet to shed).
  - `weakest`, the valid unit with the fewest remaining hit points.
  - Ties resolve toward the unit furthest along the conduit, so a tower's choice
    is deterministic. Changing priority is free and takes effect immediately; it
    never changes what a unit is valid for (see/reach), only which valid unit is
    chosen.
- Each damage tower also carries an inert-priority toggle (off by default), the
  analogue of a camo-priority option. When on, the tower fires on inert matter
  it can currently see (revealed by a detector, or seen natively) before any
  other valid target; its chosen targeting priority then orders within the inert
  group (and, when no visible inert is in range, orders the rest as usual). This
  lets a Beam or an Array Ionizer, or any tower standing in a Catalyst / Fallout
  field, be told to hunt the inert threat first instead of chipping whatever is
  furthest along. Toggling it never makes an unseen inert unit targetable; it
  only reorders the units already valid for the tower.
- The two support auras (Catalyst, Moderator) have no targeting priority and no
  inert-priority toggle. They affect every valid unit in range at once, so
  neither control applies to them.
- The damage towers aim. A damage tower's head rotates to face the unit it is
  firing at and keeps its last heading while it holds fire. Its sprite is
  authored so the head turns independently of a fixed base (`specs/assets.md`).
  The two support towers are auras and do not rotate or aim.
- A shot is a real projectile, and the projectile is what deals the damage. When
  a damage tower fires it launches a projectile from its muzzle toward the
  target; the projectile travels and applies the tower's damage on impact, never
  before. Hitscan does not satisfy this. If the target is gone before the
  projectile arrives, the shot misses. Author a projectile sprite per damage
  type, colored to it (`specs/assets.md`).
- The two support towers (Catalyst, Moderator) are auras: they continuously
  affect every valid unit in range, with no shots, no single target, and no
  projectile.
- Each tower's info, in the shop hover and the selected-tower inspector
  (`specs/board.md`), must state its damage type and what it does in words, and
  a coming round's preview must say what each type asks of the board (detect /
  kinetic-nuclear / chip-bonds).

## The five damage towers — base (tier I) stats

| Tower   | Damage type | Cost | Range | Fire rate | Damage   | Shape / special                                        |
| ------- | ----------- | ---- | ----- | --------- | -------- | ------------------------------------------------------ |
| Emitter | energy      | 200  | 100   | 1.8 /s    | 1 shell  | single target; the cheap starter                       |
| Ionizer | energy      | 280  | 110   | 3.0 /s    | 1 shell  | single target; rapid, eats swarms                      |
| Cleaver | kinetic     | 325  | 88    | 1.2 /s    | 2 shells | ×2 vs bonds; damages heavies; short range              |
| Reactor | nuclear     | 600  | 118   | 0.6 /s    | 2 shells | area burst (radius 40); hits everything, incl. heavies |
| Beam    | energy      | 500  | 200   | 0.85 /s   | 4 shells | long range, big single hit; sees inert natively        |

- Emitter, the cheapest tower and the one you field in numbers early: quick,
  low-damage energy. Does nothing to a heavy (energy), but chips bonds and
  strips atoms all day.
- Ionizer, a rapid energy stripper; the workhorse against swarms of atoms and
  the spray a Polymer throws off. Energy, so it cannot touch a heavy; pair it
  with kinetic/nuclear.
- Cleaver, kinetic: it does double damage to a bonded unit's bond pool (the
  fastest opener) and it can damage heavies. Short range, so place it early on a
  lane where it can chew clusters open before they reach the strippers.
- Reactor, nuclear: a slow, expensive area blast that damages everything in its
  radius, heavies included. A little Reactor covers a lot of a busy merge, but a
  board of nothing else cannot afford the fire rate to hold a swarm.
- Beam, a long-range lance that lands one big energy hit and sees inert matter
  natively, the premium anchor for the shared final run. Energy, so it needs its
  Disruptor branch (below) to touch heavies.

## The two support towers — base (tier I) stats

| Tower     | Cost | Range | Effect                                                                                                                                                                 |
| --------- | ---- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalyst  | 550  | 120   | reveals inert matter in its field (and for `2.0 s` after it leaves), and excites every unit in the field (`+1` to the damage each hit deals it). No damage of its own. |
| Moderator | 400  | 120   | slows every non-boss unit in its field to `×0.55` speed. A heavy resists, slowed only to `×0.78`; the boss is immune.                                                  |

- Catalyst is the board's primary detector and a damage amplifier: it opens
  inert matter for every tower nearby and makes matter in its field take `+1`
  damage per hit. Without detection somewhere, inert matter is untouchable.
- Moderator buys time: it slows matter so the damage towers land more hits, the
  answer to fast, low-electron atoms and to packing damage onto a cluster or
  isotope. Moderators do not stack multiplicatively; a unit in two fields takes
  the strongest single slow.

## Upgrades — tier II, then a branch at tier III

Each tower upgrades through three tiers, I → II → III:

- Tier II is a generic bump. A damage tower gains `+12` range, `×1.15` fire
  rate, and `+1` damage; a support tower gains `+14` range. No new behavior,
  just stronger.
- Tier III commits to one of two branches, A or B, the tower's identity choice.
  The branch is picked when you buy tier III (`specs/controls.md`), applies on
  top of tier II, and cannot be changed (sell and rebuild to switch). The
  branches:

| Tower     | Branch A                                                                               | Branch B                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Emitter   | CHARGED: `+2` damage and a small energy splash (radius `30`).                          | SPREAD: fires at up to `3` targets at once, and `+25` range.                                                                  |
| Ionizer   | ARRAY: `×1.5` fire rate, `+20` range, and detection (sees inert).                      | OVERCHARGE: `+1` damage and the hit arcs to one nearby atom.                                                                  |
| Cleaver   | REND: the shot pierces a line (up to `2` more units) and its bond bonus rises to `×3`. | IMPACTOR: `+3` damage vs heavies, a splash (radius `46`) when a heavy is cracked, and a brief slow on any unit it hits.       |
| Reactor   | CHAIN: the blast radius grows (`+34`, to `74`).                                        | FALLOUT: leaves a lingering irradiated zone (radius `46`, `3` damage/second, `3 s`) that also reveals inert matter inside it. |
| Beam      | LANCE: the shot pierces the whole lane, and `+1` damage.                               | DISRUPTOR: gains heavy damage (`+2` vs heavies), and marks the target so it takes `+1` damage from everything for `2 s`.      |
| Catalyst  | BROAD: `+30` range and the reveal lingers `4 s`.                                       | REAGENT: a stronger excite: matter in the field takes `+2` damage per hit.                                                    |
| Moderator | CRYOSTAT: a deeper slow (`×0.40`) that also grips heavies (`×0.60`).                   | CONTAINMENT: slow `×0.48` and matter in the field is brittle (`+1` damage per hit).                                           |

Because these capabilities are spread across branches, a board has many ways to
cover each threat: detection can come from a Catalyst, a Fallout Reactor, an
Array Ionizer, or a Beam; heavy damage from a Cleaver, a Reactor, or a Disruptor
Beam. That redundancy is the point: the player chooses how to cover a threat,
and both branches of a tower are worth taking.

## Building, upgrading, and selling

- Build. Select a tower in the shop (`specs/board.md`) and place it at any legal
  spot on the board. Its cost is deducted from your energy; you cannot build
  what you cannot afford, on a path, out of bounds, or where it would overlap
  another tower.
- Upgrade. A selected tower upgrades to II, then to III, where the inspector
  presents the two branch choices and you pick one (`specs/controls.md`).
  - Cost. Upgrading to II costs `1.0×` the tower's build cost; to III, `1.7×`.
    For an Ionizer that is `280` to reach II, `476` to reach III.
- Sell. A selected tower sells for a `70%` refund of everything spent on it
  (build plus upgrades), rounded down, except a tower sold during the same build
  phase it was placed on, before that round has started, which refunds its full
  spend. During the untimed opening build phase (`specs/gameplay.md`) you can
  freely place, re-shape, and sell back your opening board without penalty.
  Selling frees the spot immediately.

Upgrading and selling happen through the selected-tower inspector in the build
panel (`specs/board.md`, `specs/controls.md`). Size and role never change with
tier; only the stated stats and the chosen branch's behavior do.
