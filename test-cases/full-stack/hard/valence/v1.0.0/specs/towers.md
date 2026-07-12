# Valence — Towers

This file defines the five towers — three that break matter down and two that support —
their stats, targeting, and how you build, upgrade, and sell them. It builds on the board
and nodes in `specs/board.md`, the matter and the decomposition model in
`specs/matter.md`, the controls in `specs/controls.md`, and the economy in `specs/flow.md`.
Ranges are in logical pixels; costs and energy are the unitless values of `specs/flow.md`.

The stat numbers below are **fixed** for this version; implement them exactly as written.
Equally important is the **behavior**: each tower acts on exactly the forms named, fires
automatically at valid in-range targets, and holds fire when nothing valid is in range.

## Shared targeting rules

- A tower is built on an empty **node** (`specs/board.md`) and reaches units on the conduit
  within its **range** (a radius from the node). One tower per node.
- The three **damage** towers (Ionizer, Shear, Fission) fire at their **fire rate**
  (shots per second) at the **valid** in-range unit **furthest along** the conduit — the
  standard "first" target — and each acts only on the form it counters (`specs/matter.md`).
  A tower whose only in-range units are the wrong form **holds fire**.
- **The damage towers aim.** A damage tower's **head/turret rotates to face the unit it is
  firing at**, and keeps pointing at it as that unit moves along the conduit; while it holds
  fire (nothing valid in range) it keeps its last heading. Its sprite is authored so the
  head turns independently of any fixed base (`specs/assets.md`). The two support towers are
  auras and do not rotate or aim.
- **A shot is a real projectile, and the projectile is what deals the damage.** When a
  damage tower fires it launches a **projectile** from its muzzle toward the target; the
  projectile **travels** across the board and applies the tower's effect **on impact** —
  stripping the shell, breaking the bond, or adding the criticality **when it reaches the
  unit**, never before. **Hitscan does not satisfy this**: applying the effect the instant
  the tower fires while a projectile plays as pure decoration is prohibited — no effect may
  land until its projectile actually connects. If the target is neutralized or leaves the
  board before the projectile arrives, the shot **misses** and does nothing. Projectiles are
  fast enough that a hit normally lands well within the fire interval; author a projectile
  sprite per damage tower (`specs/assets.md`).
- The two **support** towers (Catalyst, Moderator) are **auras**: they continuously affect
  **every** valid unit within range, with no shots, no single target, no aiming, and no
  projectile.
- Each tower's info — in the shop hover and the selected-tower inspector
  (`specs/board.md`) — must state **what it targets** in words (for example "Ionizer —
  strips free reactive atoms" or "Shear — breaks molecule bonds"), so the player can tell
  which tool answers the coming round.

## The damage towers

| Tower | Role | Acts on | Cost | Range | Fire rate | Effect per shot |
| --- | --- | --- | --- | --- | --- | --- |
| **Ionizer** | Strip free atoms | free reactive atoms | 100 | 110 | 2.0 /s | strip **1** electron shell |
| **Shear** | Break molecules | molecules | 140 | 100 | 1.5 /s | break **1** bond (peel one atom) |
| **Fission** | Split heavies | heavy nuclei | 250 | 120 | 0.6 /s | add **1** criticality |

- **Ionizer** is the workhorse and the cheapest tower — the unit you field in numbers to
  strip the free atoms every chain ends in (`specs/matter.md`). It does nothing to a
  molecule, an un-catalyzed inert atom, or a heavy, so it always wants the openers
  (Shear, Fission, Catalyst) ahead of it. The tower to learn on.
- **Shear** breaks one bond per hit, peeling a molecule apart into the free atoms the
  ionizers finish (`specs/matter.md`). It does nothing to a lone atom or a heavy. Placed
  **early** on a lane, it opens molecules before they reach the ionizer line; placed too
  late, the molecule leaks unopened.
- **Fission** adds one criticality per hit and is the **only** answer to a heavy nucleus
  and the boss (`specs/matter.md`). It is slow and expensive, so a little Fission goes a
  long way, but a board with **none** cannot stop the heavies at all. When a heavy (or a
  boss step) splits, the fission event does a small **splash**: it adds `1` criticality to
  any other heavy within `40 px` of the split (helping a fission line chew through a
  cluster of heavies). Fission does nothing to molecules or free atoms.

## The support towers

| Tower | Role | Affects | Cost | Range | Effect |
| --- | --- | --- | --- | --- | --- |
| **Catalyst** | Make inert matter reactive | inert atoms; reactive matter | 180 | 120 | reveals inert; excites matter |
| **Moderator** | Slow matter (damping field) | all non-boss matter | 160 | 120 | ×**0.55** speed in field |

- **Catalyst** is an aura that does two things: any **inert** (noble) unit inside it
  becomes **reactive** — an ordinary free atom an Ionizer can then strip (`specs/matter.md`)
  — and **stays reactive** for `2.0 s` after leaving the field, so a Catalyst placed ahead
  of an ionizer line keeps nobles strippable as they pass through it. In addition, any unit
  in the field is **excited**: while excited, an **Ionizer** strips **2** shells per hit
  instead of 1 (a modest damage synergy). A Catalyst deals no damage itself; without one,
  inert matter is untouchable.
- **Moderator** is an aura that **slows** every unit in its field to `0.55 ×` its speed
  (the slow lifts the moment a unit leaves the field), buying the damage towers more time
  on a lane — the answer to **Swifts** and to packing more hits onto a molecule or heavy
  before it passes. A **heavy nucleus resists** the slow (it is only slowed to `0.78 ×`),
  and the **boss is immune** (`specs/matter.md`). Moderators do not stack multiplicatively
  — a unit in two Moderator fields takes the **strongest** single slow, not the product.

## Building, upgrading, and selling

- **Build.** Select a tower in the shop (`specs/board.md`) and place it on an empty node.
  Its cost is deducted from your energy (`specs/flow.md`); you cannot build what you cannot
  afford, and you cannot build on an occupied node.
- **Upgrade.** A selected tower can be upgraded through three levels — **I, II, III**. Each
  level applies, on top of the previous:
  - **Ionizer:** `range + 12`, `fireRate × 1.2`, and **+1 shell stripped per hit** at
    level III only (so I/II strip 1, III strips 2 — excitement from a Catalyst adds on top).
  - **Shear:** `range + 12`, `fireRate × 1.2`, and **+1 bond broken per hit** at level III
    only (so a level-III Shear peels two atoms per hit, opening Polymers far faster).
  - **Fission:** `range + 12`, `fireRate × 1.25`, and at level III its split **splash**
    radius rises from `40 px` to `70 px`.
  - **Catalyst:** `range + 15` per level, and at level III the excited-matter bonus rises
    from **+1** to **+2** extra shells stripped per Ionizer hit.
  - **Moderator:** the slow deepens `0.55 × → 0.45 × → 0.38 ×` across I/II/III, and
    `range + 12` per level. (The heavy-resist and boss-immunity still hold.)
  - **Cost.** Upgrading to **II** costs `1.0 ×` the tower's build cost; to **III**,
    `1.6 ×`. (For an Ionizer: `100` to reach II, `160` to reach III.)
- **Sell.** A selected tower sells for a **`70%` refund** of everything spent on it (build
  plus upgrades), rounded down — **except** a tower sold during the same build phase it was
  placed on, before that round has started, which refunds its **full** spend (`100%`, no
  rounding loss). A tower that has never faced a round can always be undone for a full
  refund; the `70%` refund only applies once the round it was placed on has run. This
  matters most during the untimed opening build phase before Round 1 (`specs/flow.md`):
  freely place, re-shape, and sell back your opening board without penalty. Selling frees
  the node immediately.

Upgrading and selling happen through the selected-tower inspector in the build panel
(`specs/board.md`, `specs/controls.md`). Size and role never change with level; only the
stated stats do.
