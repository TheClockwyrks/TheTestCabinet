# Valence — Gameplay: the campaign start, economy, integrity, rounds, and scoring

This file defines the campaign start this build plays, the economy, integrity,
the round progression and victory, scoring, and the key behaviors. It refers to
the board (`specs/board.md`), the matter (`specs/matter.md`), the towers
(`specs/towers.md`), and the controls (`specs/controls.md`). The game states,
the required menus, the HUD, and what is out of scope are in `specs/ui.md`.

The numeric values here are fixed; implement them exactly as written.

## The campaign start

This build plays a single campaign start, `CONTAINMENT`, reached from the main
menu. It adds the following entry to the main menu (see Game states in
`specs/ui.md`), before `HOW TO PLAY`:

- `CONTAINMENT`

(`HOW TO PLAY` is a state defined in `specs/ui.md`, not a start, and is always
shown last in the menu.)

Containment is the standard campaign. Choosing it opens the map select
(`specs/board.md`, `specs/ui.md`), where you pick which map to defend: the Easy
single-path map, the Medium branching map, or the Hard multiple-separate-paths
map. You then begin with a starting energy of `650` and a starting integrity of
`100`, and play the full 40-round run (below) on that map: break the matter down
before it reaches the collector, banking and spending energy across the
escalating rounds, until you either clear the final round with integrity to
spare (victory) or run out of integrity (containment failed). The `650` opening
buys a real starting board, several towers placed across the board rather than a
single tower, so the opening build phase is a genuine layout decision. The
economy, integrity, matter, and towers are identical on every map; the map
changes only the topology you must cover (`specs/board.md`).

This start uses every system exactly as the common specs define it, with no
overrides:

- the board, its maps, paths, and free tower placement from `specs/board.md`;
- the matter (hit points, damage types, and stackable traits) from
  `specs/matter.md`;
- the seven towers, their damage types, detection, branch upgrades, and selling
  from `specs/towers.md`;
- the controls from `specs/controls.md`;
- and the economy, integrity, the 40-round progression with its milestone boss,
  scoring, and the key behaviors below, with interest enabled as this file
  defines it.

## Energy and the economy

Energy is the currency, released when matter is broken down and spent to build
and upgrade towers, so the matter always presses against a board that is still
being built up.

- Starting energy is set by the campaign start (above).
- Damage pays. Energy is earned by damage dealt, not by units killed. Every shell
  stripped pays `1`, so a shot that strips two shells pays `2` and a shot that
  strips one pays `1`. Damage past a unit's last shell pays nothing: a `2`-damage
  shot on a unit with one shell left pays `1`. Because a unit pays out as it is
  worn down, a unit that leaks part-damaged has already paid for the damage it
  took, and fragments pay for their own shells as they are stripped in turn.
- Bond pools pay on break. Chipping a bonded cluster's bond pool
  (`specs/matter.md`) pays nothing while the pool drains. Breaking through pays
  the pool's whole value at once, and damage past its last point pays nothing on
  top: a pool of `10` pays `10` whether the breaking hit lands on `1` point or
  `4`.
- Round-clear bonus. Clearing a round (its last unit dies or leaks) pays `100`
  plus `1 × roundNumber`. This is the bulk of the early economy: the opening
  rounds field little matter, so the clear bonus, not the damage, funds the
  opening board.
- Interest. At the start of each between-round build phase you earn `5%` of your
  current energy as interest, rounded down and capped at `+50` per build phase,
  a gentle reward for banking rather than over-spending. A campaign start may
  disable interest; the containment campaign start above leaves it enabled.
- Early-send bonus. Sending the next round early (`specs/controls.md`) pays `1`
  energy per whole second left on the build-phase countdown when you send it.
- You spend energy to build and upgrade towers and recover a refund by selling
  (`specs/towers.md`). Energy never goes below `0`.

## Integrity and leaks

- You start with the integrity set by the campaign start (above).
- When a unit reaches the collector (`specs/board.md`) it leaks, costing its
  leak value in integrity (`specs/matter.md`) and is removed. A regular atom
  costs its remaining electrons (each layer is one integrity, so partial damage
  still helps); a bonded cluster or an isotope costs a fixed value (a Polymer or
  an Isotope `2`–`3`), and the boss `12`. Because matter fragments, a
  partly-broken unit still leaks its pieces: an unopened molecule or an isotope
  that slips through un-decayed costs its whole leak.
- Integrity never regenerates. If integrity reaches `0` or below, containment
  fails and the game ends (Containment failed, `specs/ui.md`), even mid-round.

## Rounds and victory

- A game is a run of `40` rounds on the map the player chose at the map-select
  screen (`specs/board.md`), numbered `ROUND 1` … `ROUND 40`.
- Between rounds there is a build phase of up to `15 s` (its countdown shown in
  the build panel, `specs/board.md`), during which no matter spawns and you
  build, upgrade, sell, and re-shape the board. Interest is paid at its start.
  You may send the next round early (`specs/controls.md`) for the early-send
  bonus, or let the timer expire to start it automatically.
- The opening build phase, before Round 1, is untimed. It shows no countdown and
  never starts on its own: the player lays their opening board at leisure and
  presses START ROUND when ready. It pays no early-send bonus, and interest
  (paid only at the start of the between-round phases) does not apply to it.
  Because nothing has faced a round yet, every tower placed in the opening phase
  is fully refundable while it lasts (`specs/towers.md`).
- During a round, matter spawns over time and is distributed across the map's
  paths (`specs/board.md`, `specs/matter.md`). A round is cleared when every
  unit it released has either been neutralized or leaked. Clearing a round pays
  its bonus and begins the next build phase.
- Milestone round. Round `40` is a single Macromass (`specs/matter.md`), the only
  one the campaign fields and the whole of that round.
- Difficulty. Every matter type is the same unit in every round: its shells, bond
  pool, decay chain, speed, and leak value are fixed by the roster in
  `specs/matter.md` and never scale with the round number. A round is made harder
  only by what its row of the round table sends and how much of it, so the
  progression is entirely in the table: more units, heavier types, and
  capabilities the board has to answer. Towers likewise do not change across
  rounds.
- Victory. Clearing the final round (Round 40) with integrity remaining wins the
  game (the Victory state, `specs/ui.md`).

## Scoring

A score accumulates across the run and shows in the HUD and end screens:

- `+ 1` for each shell stripped and `+ its value` for each bond pool broken (the
  same amounts the economy pays in energy).
- `+ 100 × roundNumber` for each round cleared.
- `+ 250 × integrityRemaining` awarded at Victory.

Score is for the end-screen result and bragging rights only; it does not affect
play and is not persisted between sessions.

## Key behaviors

The game must exhibit these behaviors. They are the observable core of the
design:

- The campaign begins at a MAP SELECT where the player picks one of several maps
  (an Easy single path, a Medium branching fork of lanes, a Hard set of multiple
  separate paths, some maps curved, some straight/right-angle) and plays the run
  on it (`specs/board.md`, this file).
- Matter enters at each inlet, is distributed across the map's paths, and leaks
  at a collector; every path carries traffic and each must be defended
  (`specs/board.md`).
- Towers are placed freely on the board (off the paths, not overlapping, no
  grid), cover the paths within their range, and fire automatically at the valid
  in-range unit furthest along (`specs/board.md`, `specs/towers.md`).
- Bonds are extra health any tower chips: any damage type drains a bonded
  cluster's bond pool (kinetic fastest), shedding a spray of free atoms, not a
  single-tower lock (`specs/matter.md`, `specs/towers.md`).
- Heavies take kinetic or nuclear only (energy is useless against them), so
  several towers can crack a heavy (Cleaver, Reactor, or a Disruptor Beam), and,
  being a radioactive isotope, it decays as it is worn down, shedding alpha
  (`6`-electron) and beta (`2`-electron) atoms and transmuting to a lighter
  isotope (`specs/matter.md`, `specs/towers.md`).
- Inert matter needs detection, available from several sources (a Catalyst aura,
  a Reactor's Fallout zone, an Ionizer's Array branch, a Beam natively); a
  Moderator slows matter (heavies resist, the boss is immune),
  `specs/matter.md`, `specs/towers.md`.
- Traits stack late (a Shroud is inert + heavy, a Chelate is inert + bonded),
  forcing layered answers; fragments continue on their path and an unopened unit
  leaks (`specs/matter.md`).
- The economy runs on the damage dealt (each shell stripped, each bond pool
  broken), the round-clear bonus, interest, and the early-send bonus; a leak
  costs integrity; `0` integrity fails containment; clearing the final round with
  integrity left wins (this file).
- Towers can be upgraded through a two-branch tier-III choice
  (`specs/towers.md`) and sold; the final round fields the Macromass, which
  fissions into daughter isotopes and particles as it is worn down
  (`specs/matter.md`).
- The game can be paused in place (status-bar pause or `Space` during a round):
  ticks freeze but the board stays interactive, so towers can still be placed,
  upgraded, and sold on the still board, with no menu shown. `Esc` instead opens
  the pause menu, which also freezes the game (`specs/controls.md`).
- The matter and tower sprites, the electron and boss animations, the
  decomposition particle bursts, and the audio are all produced with the
  on-`PATH` tools and wired in (`specs/assets.md`).
