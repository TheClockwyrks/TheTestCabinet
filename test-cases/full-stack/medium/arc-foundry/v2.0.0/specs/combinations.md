# Arc Foundry — Combination towers

A combination tower is a unique turret assembled from a recipe of base components. It is
the strongest structure in the game and the deepest project a run can undertake. This
file fixes the twelve towers, their recipes, their reference stat blocks, and the upgrade
track they climb. How a recipe is committed is in `specs/scrap-press.md`; the firing and
targeting rules a combination tower obeys are in `specs/components.md`.

## What a combination tower is

- It has no quality tier. It carries an upgrade level instead, on the four-rung track
  `0` through `COMBO_MAX_LEVEL` (`3`).
- It lands at level `0` and is raised a level at a time for Charge.
- It fires and walls exactly like a base component and obeys every rule in
  `specs/components.md`.
- It is not a base structure: it cannot be quality-combined, and it is never an
  ingredient in another recipe.
- It is buffed by an aura covering it, like any other firing structure.

## The twelve towers

`COMBOS` holds the twelve. The stat block below is each tower's reference block, the
figures a level-`3` tower scales toward; a landed tower is scaled from them by its level.

Recipe tiers are written `type@tier`, with tiers `1` Scrap through `5` Tesla-Prime.
Ability notation is `splash(radius)`, `chain(leaps, leapRange, falloff)`,
`slow(amount, duration)`, `burn(fraction, duration)`, `crit(chance, multiplier)`,
`multishot(N)`, and `aura(radius, bonus)`. Each ability behaves exactly as
`specs/components.md` defines it.

| #   | Tower        | Identifier    | Recipe                                                    | Range | Rate /s | Damage | Abilities                                                          |
| --- | ------------ | ------------- | --------------------------------------------------------- | ----- | ------- | ------ | ------------------------------------------------------------------ |
| 1   | Fuse Cluster | `fusecluster` | `regulator@1` + `rectifier@1` + `arcnode@1`               | `108` | `1.0`   | `40`   | `splash(55)`, `burn(0.4, 2.0)`                                     |
| 2   | Static Web   | `staticweb`   | `coil@1` + `capacitor@1` + `choke@1`                      | `120` | `1.2`   | `34`   | `chain(3, 80, 0.75)`, `slow(0.25, 1.2)`                            |
| 3   | Slag Driver  | `slagdriver`  | `discharge@2` + `discharge@1` + `emitter@1`               | `175` | `0.6`   | `120`  | `crit(0.25, 2.0)`                                                  |
| 4   | Corroder     | `corroder`    | `rectifier@3` + `regulator@3` + `choke@2`                 | `110` | `1.1`   | `40`   | `burn(0.6, 3.0)`, `slow(0.2, 1.0)`, `aura(80, 0.10)`               |
| 5   | Ion Prism    | `ionprism`    | `discharge@3` + `rectifier@4` + `emitter@2`               | `140` | `0.9`   | `220`  | `splash(50)`, `burn(0.5, 2.0)`, `crit(0.2, 1.8)`                   |
| 6   | Fork Array   | `forkarray`   | `emitter@3` + `capacitor@3` + `coil@2`                    | `118` | `1.8`   | `100`  | `multishot(3)`                                                     |
| 7   | Null Core    | `nullcore`    | `regulator@5` + `capacitor@4` + `arcnode@3`               | `120` | `1.0`   | `420`  | `splash(55)`, `aura(100, 0.20)`                                    |
| 8   | Rupture Node | `rupturenode` | `discharge@5` + `arcnode@4` + `emitter@3`                 | `150` | `0.7`   | `1770` | `splash(60)`, `burn(0.5, 2.0)`                                     |
| 9   | Blight Coil  | `blightcoil`  | `rectifier@5` + `choke@4` + `coil@2`                      | `128` | `1.1`   | `375`  | `chain(3, 80, 0.7)`, `burn(0.6, 3.0)`, `slow(0.3, 1.5)`            |
| 10  | Reactor Pile | `reactorpile` | `coil@5` + `choke@3` + `regulator@2`                      | `130` | `1.4`   | `420`  | `chain(4, 85, 0.75)`, `multishot(2)`                               |
| 11  | Aurora Lance | `auroralance` | `choke@5` + `coil@4` + `discharge@4`                      | `190` | `0.7`   | `1980` | `chain(2, 75, 0.6)`, `slow(0.4, 1.8)`                              |
| 12  | Singularity  | `singularity` | `arcnode@5` + `regulator@4` + `rectifier@2` + `arcnode@2` | `150` | `1.0`   | `490`  | `splash(65)`, `burn(0.6, 2.5)`, `crit(0.3, 2.2)`, `aura(90, 0.15)` |

A recipe is an exact multiset of base `(type, tier)` ingredients. The Singularity's recipe
calls for two Arc-Nodes at different tiers, and a recipe is satisfied only when the yard
holds every ingredient it lists, counted as a multiset.

## Level scaling

A landed tower's live stats derive from its reference block and its level. Fire rate and
every ability parameter are flat across level, so a tower scales through its damage
alone.

| Stat   | Rule                                                                                                  |
| ------ | ----------------------------------------------------------------------------------------------------- |
| Damage | `referenceDamage * COMBO_DAMAGE_MULT[level]`, where `COMBO_DAMAGE_MULT` is `[0.5, 0.63, 0.78, 1.02]`. |
| Range  | `referenceRange + COMBO_RANGE_BONUS[level]`, where `COMBO_RANGE_BONUS` is `[0, 4, 8, 12]`.            |

A tower therefore lands at half its reference damage and reaches slightly past it at
level `3`.

## Upgrade cost

Raising a tower one level costs a fraction of its reference damage in Charge, rounded to
the nearest integer with an exact half rounding up. `COMBO_UPGRADE_COST_FRAC` holds the
three fractions.

| Reaching level | Fraction of reference damage |
| -------------- | ---------------------------- |
| `1`            | `0.8`                        |
| `2`            | `1.5`                        |
| `3`            | `2.8`                        |

Upgrading is allowed in any phase, including during a live wave. It is refused at level
`3` and when the player cannot afford the next level.

## What each tower does

The inspector shows a one-line description of the selected tower. These are the twelve:

| Tower        | Description                                                                  |
| ------------ | ---------------------------------------------------------------------------- |
| Fuse Cluster | A splash bolt that also burns what it hits.                                  |
| Static Web   | A chaining bolt that slows every unit it forks through.                      |
| Slag Driver  | A long-range heavy bolt that can land a critical hit.                        |
| Corroder     | Burns and slows what it hits, and projects a damage aura over nearby towers. |
| Ion Prism    | A splash bolt that burns on impact and can crit.                             |
| Fork Array   | Fires at three separate targets at once.                                     |
| Null Core    | A splash core wrapped in a strong damage aura.                               |
| Rupture Node | A heavy shot that detonates a large burning splash.                          |
| Blight Coil  | A chaining bolt that both slows and burns everything it forks through.       |
| Reactor Pile | Fires two heavy chain-lightning bolts at once.                               |
| Aurora Lance | Enormous reach and per-hit damage, a hard slow, and a chaining strike.       |
| Singularity  | Splash, burn, critical hits, and a damage aura in one tower.                 |

## Appearance

A combination tower wears an accent that is not worn by any base component, so it reads
as a combination tower on sight. Its look reads its dominant ability. It is drawn as a
rotatable head over a fixed base like a firing base component, and a tower whose only
output is its aura may instead be drawn as an aura emitter with no head.
