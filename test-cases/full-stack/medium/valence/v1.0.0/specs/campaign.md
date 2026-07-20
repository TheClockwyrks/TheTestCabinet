# Valence — Economy, integrity, rounds, states, and HUD

This file defines the economy, integrity, the round progression and victory,
scoring, the game's state machine, the HUD's meaning, the key behaviors, and
what is out of scope. It refers to the board (`specs/board.md`), the matter
(`specs/matter.md`), the towers (`specs/towers.md`), the controls
(`specs/controls.md`), and the campaign start in `specs/mode.md`.

The numeric values here are fixed; implement them exactly as written, except the
starting energy and integrity, which `specs/mode.md` sets per campaign start.

## Energy and the economy

Energy is the currency, released when matter is broken down and spent to build
and upgrade towers, so the matter always presses against a board that is still
being built up.

- Starting energy is set by the campaign start (`specs/mode.md`).
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
  disable interest (`specs/mode.md`).
- Early-send bonus. Sending the next round early (`specs/controls.md`) pays `1`
  energy per whole second left on the build-phase countdown when you send it.
- You spend energy to build and upgrade towers and recover a refund by selling
  (`specs/towers.md`). Energy never goes below `0`.

## Integrity and leaks

- You start with the integrity set by the campaign start (`specs/mode.md`).
- When a unit reaches the collector (`specs/board.md`) it leaks, costing its
  leak value in integrity (`specs/matter.md`) and is removed. A regular atom
  costs its remaining electrons (each layer is one integrity, so partial damage
  still helps); a bonded cluster or an isotope costs a fixed value (a Polymer or
  an Isotope `2`–`3`), and the boss `12`. Because matter fragments, a
  partly-broken unit still leaks its pieces: an unopened molecule or an isotope
  that slips through un-decayed costs its whole leak.
- Integrity never regenerates. If integrity reaches `0` or below, containment
  fails and the game ends (Containment failed, below), even mid-round.

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
  game (the Victory state, below).

## Scoring

A score accumulates across the run and shows in the HUD and end screens:

- `+ 1` for each shell stripped and `+ its value` for each bond pool broken (the
  same amounts the economy pays in energy).
- `+ 100 × roundNumber` for each round cleared.
- `+ 250 × integrityRemaining` awarded at Victory.

Score is for the end-screen result and bragging rights only; it does not affect
play and is not persisted between sessions.

## Game states

The game is a small state machine. Each state has a clear screen and controls
(controls are defined in `specs/controls.md`).

1. Title / main menu. Shows the title `VALENCE`, a tagline, and a vertical menu
   listing the playable start defined by `specs/mode.md` (which declares its own
   entry), followed by `HOW TO PLAY`. The selected item is highlighted. A dim
   slice of a live board may show behind the menu for atmosphere.
2. Map select. Reached from the campaign start on the main menu
   (`specs/mode.md`). Lists the maps the campaign offers (`specs/board.md`), at
   least the Easy single-path, the Medium branching, and the Hard
   multiple-separate-path maps, each showing its name, difficulty, topology
   (single / branching / multiple), and path style (curved / straight), with a
   small preview of its path shape. Choosing a map begins the 40-round campaign
   on it; a BACK choice returns to the main menu.
3. How to play. Describes the goal (break matter down before it reaches the
   collector), the controls, the hit-point / damage-type model, and the three
   stackable traits and what each asks of the board: bonded (chip its bond pool,
   any tower, kinetic best), heavy (kinetic or nuclear only), inert (needs a
   detector), plus the Moderator's slow, the Catalyst's reveal, and the economy
   and integrity. Returns to the menu.
4. In play. The live game: the chosen map's paths, matter flowing along them,
   the towers firing and the support auras, and the full HUD and build panel.
   This covers both the build phase (countdown running, no matter spawning) and
   the round phase (matter active); building is allowed in both
   (`specs/controls.md`). Play can be paused in place here (ticks freeze while
   the board stays fully interactive, with no menu over it) via the status-bar
   pause control or `Space` during a round (`specs/controls.md`).
5. Paused. The `Esc` overlay menu, reachable in play. Offers Resume, Restart,
   and Quit to menu. The board is visible but frozen behind the menu. This is
   separate from the in-place pause of state 4: the menu freezes the game and
   covers it, whereas the in-place pause freezes the game but keeps it playable.
6. Victory. Shown when the final round is cleared with integrity remaining.
   Displays the final score, rounds survived (all `40`), and integrity
   remaining, with PLAY AGAIN and MENU.
7. Containment failed. Shown when integrity reaches `0`. Displays the final
   score and the round reached, with PLAY AGAIN (or TRY AGAIN) and MENU.

## Required menus

Every menu and screen below must be present and reachable. Each entry states its
content (what must appear) and its navigation (where its choices lead); the
visual layout, styling, and interaction details are yours, subject to the
palette and type of `specs/overview.md`. The campaign start's menu entry is in
`specs/mode.md`.

- Main menu, the title, a tagline, the playable start from `specs/mode.md`, then
  HOW TO PLAY. The start leads to the map-select screen; HOW TO PLAY leads to
  the how-to-play screen.
- Map select, the maps the campaign offers, each with its name, difficulty,
  topology, and path style (`specs/board.md`); choosing one begins a game on
  that map; BACK returns to the main menu.
- How to play, the goal, the controls, the hit-point / damage-type model, the
  three stackable traits and what each asks of the board, and the economy; a way
  back to the menu.
- Pause menu, Resume, Restart, and Quit to menu, over the frozen board.
- Victory screen and Containment-failed screen, the end-of-game results with
  PLAY AGAIN and MENU. PLAY AGAIN replays the same campaign start on the same
  map; MENU returns to the main menu.

Every menu must be fully operable with the mouse alone, with the keyboard
accelerators of `specs/controls.md` as an alternative. This specification fixes
the content and navigation of these menus, not their layout or presentation.

## HUD

The HUD is the top status bar and the right build panel (`specs/board.md`),
drawn in code (`specs/assets.md`; only their small icons may be produced
sprites), always fully visible:

- Status bar (`y` in `[0, 56]`): energy, integrity (turning to the alert color
  as it runs low), the round indicator `ROUND n / 40` with the current round's
  progress or the build-phase countdown, and the speed, pause, and mute
  controls.
- Build panel (`x` in `[1000, 1280]`): the shop (each tower's name, cost, icon,
  and on hover its info), the selected-tower inspector (level, live stats,
  upgrade and sell), the next-round preview (the coming round's types, shown
  when nothing is selected or hovered), and the START ROUND / send-early control
  with the speed toggle.

On the board, each unit carries its integrity read (a free atom's shells, a
bonded cluster's draining bond pool, a heavy's draining shells, a shroud/reveal
mark on inert matter, `specs/matter.md`) and each tower reads as its type,
damage type, and chosen branch, and shows its range when selected or held. A
player must be able to read, without hunting, whether they can afford the next
tower, how close integrity is to zero, what the coming round needs, and which
capability each unit on the board demands.

## Key behaviors

The game must exhibit these behaviors. They are the observable core of the
design:

- The campaign begins at a MAP SELECT where the player picks one of several maps
  (an Easy single path, a Medium branching fork of lanes, a Hard set of multiple
  separate paths, some maps curved, some straight/right-angle) and plays the run
  on it (`specs/board.md`, `specs/campaign.md`).
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
- The economy runs on neutralize bounties, the round-clear bonus, interest, and
  the early-send bonus; a leak costs integrity; `0` integrity fails containment;
  clearing the final round with integrity left wins (this file).
- Towers can be upgraded through a two-branch tier-III choice
  (`specs/towers.md`) and sold; the milestone rounds field Macromass bosses that
  fragments as it is worn down (`specs/matter.md`).
- The game can be paused in place (status-bar pause or `Space` during a round):
  ticks freeze but the board stays interactive, so towers can still be placed,
  upgraded, and sold on the still board, with no menu shown. `Esc` instead opens
  the pause menu, which also freezes the game (`specs/controls.md`).
- The matter and tower sprites, the electron and boss animations, the
  decomposition particle bursts, and the audio are all produced with the
  on-`PATH` tools and wired in (`specs/assets.md`).

## Out of scope

- Network or online multiplayer, and any saved/persisted progress between
  sessions.
- Touch or gamepad input (mouse and keyboard only for this version).
- A board editor or procedurally generated maps; the maps are the fixed,
  hand-authored set of `specs/board.md` (the player chooses among them at map
  select, but cannot edit or generate one).
- An in-run research or tech tree beyond the per-tower upgrades of
  `specs/towers.md`.
- Any matter form, tower, or mechanic beyond those specified here; keep the
  scope to the systems above, done well.
