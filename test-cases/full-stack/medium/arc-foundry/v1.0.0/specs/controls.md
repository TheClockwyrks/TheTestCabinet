# Arc Foundry — Controls

This file defines how the player interacts with the yard: the simulation step,
pulling the scrap-press and placing rocks, selecting and inspecting a candidate or
component, the keep / combine / upgrade-quality / targeting controls, driving the
waves, and the speed and pause controls. It builds on the tile grid, the waypoint
zones, and the build-panel layout in `specs/board.md`, the components in
`specs/towers.md`, the build loop in `specs/build.md`, and the gameplay and UI in
`specs/gameplay.md` and `specs/ui.md`.
Mouse and keyboard only; no touch or gamepad for this version, and every interaction
and menu must be achievable with the mouse alone, with the keyboard shortcuts as
accelerators.

## Simulation

Run the simulation on a fixed timestep of 60 Hz — a tick of exactly 1/60 of a second —
decoupled from rendering, so unit movement, pathing, component fire, projectiles,
and the economy are reproducible and independent of the render frame rate. The rate is
fixed rather than a suggestion, because `specs/instrumentation.md` advances the simulation
in whole ticks of it, and a tick is only a unit if its length is fixed. Render with smooth
interpolation between ticks. The speed control (below) scales how many ticks pass per
real second; it must change only how fast the game plays, never the outcome. Pause
halts ticks entirely, and comes in two forms that both freeze ticks but differ in what
else they do, an in-place pause and the pause menu, both described under Waves, speed,
and pause below.

## What is build-phase-only, and what is not

Anything that touches this level's fresh rolls is build-phase-only: pulling the
press, placing rocks, keeping, downgrading a candidate, and dismantling happen only
during a build phase (`specs/gameplay.md`), since candidates do not survive into a wave.
While a wave is running those controls are shown disabled in place, never removed
(see the fixed-slot rule below).

Everything that touches only standing structures, future rolls, or Charge is not
restricted to the build phase and may be done during a live wave: changing a
component's targeting, a plain COMBINE of standing towers (a quality-climb or
combination-tower recipe folding only pieces already on the yard), UPGRADE QUALITY
(it biases only future rolls), and upgrading a combination tower. So mid-wave a
player folds their standing towers together, upgrades their combos, and refines the
press as the situation demands, but never spends a fresh roll (there are none in a
wave).

There is no SEND control: a wave starts when the level's harvest is committed, a
KEEP, a DOWNGRADE, or a COMBINE that consumes a fresh roll, and every level must
harvest one tower to advance (`specs/build.md`).

## Stamping and placing a rock (the scrap-press)

The player builds only by pulling the scrap-press, which puts a blank rock on the
cursor to drop on the grid; the component is rolled where the rock lands, not when
you pull (`specs/build.md`):

1. Pull the press. Click the STAMP control in the build panel (`specs/board.md`), or
   press its hotkey `B`, to arm a blank rock on the cursor. Placing rocks is free;
   STAMP is refused (clearly) only when the 5-stamp allowance is spent; the allowance
   is a hard cap of five per level and is not a function of Charge (`specs/build.md`).
2. Position. The blank rock is held on the cursor as its uniform `2×2` tile footprint
   (`specs/board.md`), snapping to the grid under the pointer. The preview shows a
   legal/illegal footprint cue (`#46d07a` legal, `#ff4d4d` illegal). A footprint is
   illegal if any of its four tiles is off the board, already blocked by a
   component/blocker or a fixed housing, a waypoint-zone tile, or if placing it would
   seal any waypoint segment (the never-seal rule, `specs/board.md`).
3. Place. Left-click a legal footprint to drop the rock: it lands, rolls a random
   component type at a random quality on the current Refinement odds (`specs/build.md`),
   becomes an ACTIVE candidate (walling and inspectable, not yet yours), and the floor
   re-paths around it (`specs/board.md`). A build spark effect fires at the new footprint
   (`specs/assets.md`).
4. Continuous placement. After a drop, if a stamp remains, the press immediately arms
   another rock on the cursor so you place five back-to-back without re-clicking STAMP
   (`specs/build.md`). Placement ends when the allowance is exhausted, or you cancel.
5. Cancel (free). Press `Esc` or right-click while holding a rock to put it away with
   no stamp consumed (`specs/build.md`).

Dropping a rock onto an existing blocker rerolls that blocker into a fresh candidate
(spending a stamp, still free), the way you turn an old wall into a tower
(`specs/build.md`).

The scrap-press area of the build panel must always show the current quality-roll
odds, the probability of each quality tier for the next rock at the live Refinement
level (`specs/build.md`), so the player can read what a placement is likely to roll
before committing a stamp, and see how buying UPGRADE QUALITY shifts those odds. Show
the same odds while a blank rock is held.

## Selecting and inspecting a candidate or component

### The inspector's action controls hold fixed slots

The inspector's action buttons must not move on their own. Every action a selected
structure can ever offer is drawn for as long as that structure stays selected, each
in a fixed slot, in a fixed order. An action that is not usable right now is drawn
disabled in its own slot, visibly inert and ignoring clicks. It is never hidden,
removed, or collapsed, and the buttons around it never close the gap.

The consequence is the requirement: no change in game state may add, remove, resize,
or move a control. A wave starting or ending, Charge accruing or being spent, a
combinable partner appearing on the board, a candidate reaching the top of the
quality ladder, and every other change the player did not directly ask for must
leave the panel's geometry untouched and change only which controls are enabled. A
player who reaches for a control must never have a different control slide under the
pointer between the decision and the click, and several of these controls are
destructive and irreversible.

Layout may change when the player themselves causes it: selecting a different
structure, deselecting, or opening an overlay. Those are the only permitted causes.

- Select. Left-click a placed candidate, component, or blocker (when not holding a
  rock) to select it as the primary selection. The selection shows its range ring on
  the yard (firing components and candidates only), and the inspector in the build
  panel (`specs/board.md`) shows its type, one of the eight base component types
  (Capacitor, Coil, Emitter, Arc-Node, Discharge Rig, Choke, Rectifier, Regulator) or
  a combination tower (`specs/towers.md`), its quality tier (base types only; a combo
  shows its upgrade level instead), a short description of what the component does,
  live stats (damage, range, fire rate, targeting), and its action controls. For a
  firing component it also shows a per-component performance tally, its kills and total
  damage dealt. A Regulator, and any other non-firing support piece, shows its aura
  (radius and damage bonus) in place of damage/rate and has no targeting control
  (below). A blocker reads as inert (no range, no targeting) and offers only a
  DISMANTLE action (below).
- Multi-select (for combining). Shift-click additional base structures (candidates or
  base components) to add them to an explicit combine set alongside the primary; the
  set's members pulse brighter than the ambient combinable-piece pulse (below).
  Combining then folds exactly that set (a matched pair, or a recipe multiset), so a
  player can choose precisely which duplicate copies to fold, and, in particular, pick
  standing towers only for a plain COMBINE that keeps the build phase open. A plain
  (non-shift) click clears the set back to a single selection.
- Keep. With a candidate selected during the build phase, click KEEP or press `K` to
  harvest it (`specs/build.md`). This is immediate and final: the candidate becomes a
  permanent firing component, every other candidate hardens into a blocker, and,
  because a harvest is the wave trigger (there is no SEND), the wave starts at once.
  There is no reversible/marked keep; place and compare all your rocks first, then
  commit the one you want.
- Combine — immediate; the harvest (and wave start) only if it spends a fresh roll.
  With a base structure (a candidate or a base component) selected, the inspector may
  offer combine actions, resolving the instant you commit it for no Charge with a
  combine flash effect (`specs/assets.md`). The result lands at the primary
  (initiating) piece's footprint, so a combine can replace a standing tower. What it
  consumes sets its kind (`specs/build.md`): folding in `≥1` fresh candidate is the
  level's harvest, it starts the wave; folding only standing towers is a plain COMBINE
  that is not a harvest and leaves the phase running (the only combine allowed during a
  live wave). The inspector labels the action COMBINE; it does not annotate whether a
  given fold sends the wave (the harvest-sends-the-wave rule is taught once on the
  how-to screen). With an explicit shift-multi-select, the exact chosen copies fold;
  otherwise the game resolves the ingredients itself, always preferring to consume a
  fresh candidate over a standing tower (`specs/build.md`). Every base structure that
  could combine right now pulses on the board at all times so the player is shown which
  pieces can fold without selecting anything; the selected fold pulses brighter.
  - Quality-combine. A COMBINE action appears when the selected piece has a matching
    candidate or base component of the same type and same quality on the board
    (`specs/build.md`). Clicking it, or pressing `C`, immediately produces one component
    a tier higher at the initiating piece's footprint and consumes the partner, whose
    footprint hardens into a blocker so the maze is unchanged. It sends the wave when
    the selected piece or its auto-picked partner is a fresh candidate, or leaves the
    phase open when both are standing towers. A Tesla-Prime piece offers no
    quality-combine.
  - Recipe-combine. When the board (candidates and/or existing base components),
    together with the selected initiator, holds the exact multiset of `(type, quality)`
    ingredients a combination recipe needs (`specs/towers.md`), the inspector shows each
    reachable recipe and a `COMBINE SPECIAL → <combo name>` action naming the
    combination tower it would build. Clicking that action immediately assembles it: the combination
    tower lands at the initiator's footprint (landing at upgrade level 0), and every
    consumed ingredient footprint hardens into a blocker, wall-neutral, never opening a
    hole (`specs/build.md`, `specs/board.md`). A recipe that folds in a fresh candidate
    is the level's harvest and starts the wave, including the one-shot where every
    ingredient was placed this phase; a recipe of only standing towers is a plain
    COMBINE that keeps the phase open. A combo is not a base structure, so it never
    itself offers a COMBINE.
- Downgrade (a harvest one quality tier lower, sends the wave). With a candidate
  selected in the build phase, the inspector shows a DOWNGRADE control, labelled
  `DOWNGRADE <tier>`, or press `G`, that harvests it as a firing component one
  quality tier lower, for no Charge (`specs/build.md`). The control reads DOWNGRADE,
  never KEEP: keeping the piece is implied by harvesting it, and the tier drop is what
  distinguishes the action. Because it is the level's harvest it sends the wave, like
  KEEP; to use the lowered tower as a recipe ingredient, fold it with a standing
  COMBINE during the wave. It applies only to candidates (this level's fresh rolls); a
  standing component, a combination tower, and a blocker cannot be downgraded, and a
  Scrap (T1) candidate has no rung below it, so the control sits disabled there.
- Upgrade quality / upgrade combo (any phase). The `U` key and the build-panel
  controls are contextual: with a combination tower selected, UPGRADE raises that
  combo's level for Charge (up to level 3, `specs/towers.md`); otherwise UPGRADE
  QUALITY buys the next Refinement level, biasing future rolls toward higher qualities
  (`specs/build.md`). Both are available in any phase, including during a live wave.
  Refinement is disabled at R8 or when you cannot afford the next cost; a combo upgrade
  is disabled at level 3 or when you cannot afford it.
- Targeting. With a firing component selected, the inspector shows a targeting control
  that cycles its priority, `first` → `last` → `nearest` → `strongest` → `weakest` and
  back, on each click or press of `T`. The priority applies to that component only,
  defaults to `first` (furthest along the waypoint chain), and takes effect immediately
  (`specs/towers.md`). Targeting may be changed at any time, including during a live
  wave, since it is not a build action. A non-firing piece, the Regulator, whose only
  effect is its aura (`specs/towers.md`), has no targeting control, since it never
  picks a target. The automatic abilities (slow, burn, crit, multishot, aura) need no
  player controls; they apply on their own when a component that carries them fires or
  radiates.
- Dismantle. With a structure selected during the build phase, the inspector shows a
  DISMANTLE control, or press `X` (also `Delete` / `Backspace`), that removes it,
  clears its footprint, and re-paths the floor (`specs/board.md`). It is a
  misplacement correction, not a sale: it returns nothing, no stamp, ever, including
  for a candidate placed that same phase (a refund would let you re-roll the press for
  free, defeating the RNG, `specs/towers.md`). Dismantling is disabled during a live
  wave.
- Deselect. Click empty yard or press `Esc` to deselect.

## Waves, speed, and pause

- Sending a wave (no SEND button). There is no send control: a wave starts when you
  commit the level's harvest, a KEEP, a DOWNGRADE, or a COMBINE that spends a fresh roll,
  and every level must harvest one tower to advance (`specs/build.md`). Every build
  phase is untimed: it never starts on its own, shows no countdown, and the Load waits
  until you harvest. The build panel shows a non-clickable prompt (e.g. KEEP OR COMBINE
  A ROLL TO SEND, reading …TO START before Wave 1) so the player knows the harvest
  launches the wave; there is no early-send bonus and no build-phase timer
  (`specs/gameplay.md`). Once a wave is live, `Space` toggles the in-place pause
  (below); in the build phase `Space` does nothing.
- Speed. A speed toggle in the panel, or `F`, cycles the game speed through `1×` →
  `2×` → `4×` → `8×` and back, scaling how many ticks pass per second (the current
  speed is shown, `specs/board.md`). The fixed-timestep sim advances in fixed
  sub-steps, so a higher speed only plays faster, never changing the outcome. It
  applies to the whole simulation and persists until changed.
- In-place pause. A dedicated pause control in the status bar, and, once a wave is
  live, `Space`, pauses and resumes in place: it freezes ticks (the Load, fire,
  projectiles, and the economy all halt) without opening a menu, so you can watch the
  frozen board and read it, then resume. The frozen state reads clearly as PAUSED
  (`specs/board.md`). This is distinct from the pause menu below.
- Pause menu. `Esc` with nothing held or selected opens the Paused overlay menu,
  Resume, Restart, Quit to menu (`specs/ui.md`), which also freezes the board behind
  it; while holding a rock or with something selected, `Esc` first cancels/deselects
  that. Resume returns to normal running play, clearing any in-place pause.
- Mute. `M`, or the status-bar control, toggles audio mute (`specs/ui.md`).

## HUD readouts and overlays

Beyond the core resources, the status bar carries a few information aids the player
can read or toggle at any time during play (both build and live-wave phases). Each
must be operable with the mouse alone, with a keyboard accelerator as an alternative.

- Maze length. The status bar shows how long the current maze is, the length of the
  ground route the Load walks through the ordered waypoint chain around your walls
  (`specs/board.md`), expressed in a stable unit (e.g. tiles). It updates live as you
  build, so the player can see a placement lengthen the route. Hovering the readout
  draws the full ground path on the yard (a highlighted line from Entry through every
  waypoint to the Collector). This is the walking route only: air units ignore the maze
  (`specs/enemies.md`, `specs/board.md`), so the flyers' straight-line path is not part
  of this figure and is not drawn.
- Combinations (recipe book). A COMBOS toggle, or `V`, opens an in-game reference
  listing every combination tower, each with its exact recipe (`(type, quality)`
  ingredients) and headline stats (`specs/towers.md`, `specs/build.md`), so the player
  can plan combines without leaving the game. Each combo also carries a plain-language
  description of what it does, shown at least on hover (a floating tooltip over its
  entry) so the terse stat/keyword summary is never the only explanation. The book reads
  against the live board: every ingredient of every recipe is drawn in one of three
  states, distinct enough to tell apart at a glance.

  | Ingredient state | When it applies |
  | --- | --- |
  | Selected | The current selection is a base piece (a standing base component or an uncommitted candidate) at that ingredient's type and quality. |
  | Owned | The player holds a base piece at that ingredient's type and quality that is not the current selection. |
  | Missing | Neither of the above. |

  Ownership counts as a multiset, so a recipe calling for two ingredients at the same
  type and quality reads as covered only when the board holds two. Blockers and
  combination towers are never ingredients (`specs/build.md`), so they never count as
  owned. The combos whose recipe consumes the current selection are also emphasized as a
  whole, so the player can see at a glance where the selection can go. How the three
  states and that emphasis are drawn is the implementation's call. Toggling the book
  again (or its close control) dismisses it. It is a read-only overlay and does not pause
  or alter the game.
- Damage leaderboard. A DMG BOARD toggle, or `L`, opens a live ranking of the player's
  towers by total damage dealt, updating in real time as the wave runs (it may also
  show each tower's kills). Hovering a row spotlights that tower on the yard: every
  other piece renders in grayscale so the leaderboard tower is unmistakable. Toggling
  it again (or its close control) dismisses it. Like the recipe book, it is a read-only
  overlay.

## Menu navigation

In the title, map-select, difficulty-select, how-to-play, pause, victory, and overload
screens (`specs/ui.md`, `specs/modes.md`), the pointer and/or `Up`/`Down` (or
`W`/`S`) move the selection and `Enter`/`Space` confirms; `Esc` backs out of a submenu
to the previous screen. The map-select and difficulty-select screens must let the
player read what each choice changes before confirming (`specs/modes.md`). Every menu
must be fully operable with the mouse alone, with these keyboard accelerators as an
alternative.

## Keyboard shortcuts (accelerators)

The mouse path above is the primary pointing device; the shortcuts below are required
alongside it, and a held key must not auto-repeat an action meant to fire once per
press (pulling the press, keeping, combining, downgrading, upgrading,
toggling speed, pausing, cycling targeting):

- Pull the scrap-press (STAMP): `B`
- Keep selected candidate (harvest — sends the wave): `K`
- Combine the current selection: `C` — folds a matching quality pair or a recipe
  multiset, immediately, in the build phase or a live wave. With a shift-multi-select
  it folds that exact set; otherwise it auto-resolves. A specific recipe (when several
  are in reach) is committed with the mouse via the named `COMBINE SPECIAL → <combo name>`
  action. A fold that spends a fresh roll is the harvest and sends the wave.
- Shift-click: add / remove a base structure from the explicit combine set.
- Downgrade selected candidate one tier (build phase): `G`
- Upgrade — the selected combo's level, else UPGRADE QUALITY (Refinement); any phase:
  `U`
- Cycle targeting priority (component selected): `T`
- Cancel held rock / deselect / back: `Esc`
- In-place pause (while a wave is live): `Space`
- Speed toggle (`1×`/`2×`/`4×`/`8×`): `F`
- Toggle the combinations recipe book: `V`
- Toggle the live tower damage leaderboard: `L`
- Mute: `M`

Whatever exact keys you choose, list them in the in-game How to play screen
(`specs/ui.md`) and in the produced `README.md`.
