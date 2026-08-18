# Arc Foundry — The Build Loop

This file defines the scrap-press build loop, the signature of the game. Each level
you place a fixed number of rocks from the scrap-press; each rock reveals a random
component the instant it lands, and then you keep exactly one of that level's rolls
as a firing tower. Every rock you do not keep stays on the yard as an inert blocker,
a wall that shapes the maze but never fires. Keeping the maze long, choosing which
single roll to keep, climbing the quality ladder by combining matches, and
assembling multi-part combination towers from a recipe of rolls is the strategic
heart of the game.

This builds on the components and their quality ladder in `specs/towers.md`, the
tile grid, the uniform footprint, the waypoint zones, and the waypoint pathing /
never-seal / re-path rules in `specs/board.md`, the economy (Charge, the untimed
build phase) in `specs/gameplay.md`, and the stamp / keep / combine / upgrade-quality /
targeting controls in `specs/controls.md`. Charge is the unitless money of
`specs/gameplay.md`.

The numbers below are fixed for this version; implement them exactly as written.
Equally important is the behavior: the roll happens on placement, you may only keep
one roll per level, everything else becomes a blocker, and the climb is paid in
rolls and quality-refinement, not in flooding the board.

## The build loop in one paragraph

A level is one build phase plus the wave that follows it. At the start of each
build phase you get a fresh allowance of 5 rock stamps. You pull the press to
put a rock on the cursor and drop it on the yard; the moment it lands it rolls a
random component type at a random quality and becomes a candidate you can
inspect, but nothing is yours yet. Place up to five and compare their rolls,
then take the level's one harvest, and there is no separate SEND: committing the
harvest immediately launches the wave. The ways to harvest, each of which sends
the wave on the spot: KEEP one candidate as a firing tower; DOWNGRADE it,
harvesting it one quality tier lower for a low-tier recipe ingredient; or a
COMBINE that folds one or more of this phase's rolls into a stronger tower.
Every level must harvest one tower to advance: a level cannot end with nothing
kept. Every rock you did not keep or fold hardens into an inert blocker that
walls the yard but never fires. A separate, non-harvest move is a plain COMBINE
of only your standing towers: it spends no fresh roll, is not the harvest, and
leaves the phase running. It is the only combine available during a live wave,
so you climb your board's quality and assemble combos across the waves, not by
hoarding a single level's rolls. Do that level after level, dozens of times
over, spending scarce kill income (in any phase, even mid-wave) on UPGRADE
QUALITY to bias your rolls upward and on upgrading your combination towers, and
walling the Load into an ever-longer maze it must crawl through, without ever
fully sealing a waypoint segment.

## Rocks, candidates, blockers, and components

Four things live in the build loop; all occupy the uniform 2×2 footprint
(`specs/board.md`) and all except the held rock are walls:

- Rock (held): a blank rock on the cursor after you pull the press. It has no type
  or quality yet and is not on the board. Cancelling it costs nothing.
- Candidate: a rock after it lands: it has rolled a random type + quality (revealed
  in the inspector), walls its footprint, and is eligible to be kept or combined this
  level only. Candidates exist only during the build phase.
- Blocker: a candidate you did not keep, hardened at wave start into an inert wall:
  it blocks pathing forever but never fires, has no range, targeting, or head.
  Blockers are the cheap maze material. A future stamp may be dropped onto a blocker
  to reroll it back into a candidate (see below).
- Component: a candidate you kept (or a combine result): it fires at its stats
  (`specs/towers.md`) and walls. Permanent.

Blockers and components (and candidates) all block pathing identically; the
difference is that only a component fires, and only a candidate can be kept or
combined.

## Builds-per-level (fixed — constant across difficulty)

- Each level grants a fixed builds-per-level = 5 rock stamps.
- The allowance refreshes to 5 at the start of every build phase. Unused stamps do
  not carry over.
- The allowance is a hard cap of five placements per level. Placing rocks is free;
  Charge is never spent on placement, so the five-per-level allowance is the only
  limit on how many rocks you place. Having any amount of Charge, or none at all,
  never changes the cap: you always get exactly five stamps.
- Pulling the press, keeping, downgrading, and dismantling happen only
  during the build phase; candidates exist only then (`specs/gameplay.md`). Combining
  standing towers, UPGRADE QUALITY, and upgrading combination towers are available in
  any phase, including during a live wave (they touch only standing structures /
  future rolls / Charge).
- Builds-per-level is identical on Easy, Medium, and Hard. Difficulty changes only
  the wave count and enemy toughness (`specs/modes.md`).

The panel's scrap-press control shows the remaining stamps of the 5-per-level
allowance and that placement is free (`specs/controls.md`, `specs/gameplay.md`).

## The stamp — a rock that rolls on placement (fixed odds)

Pulling the press puts a blank rock on the cursor. The roll happens when the rock
lands, not when you pull the press, so there is no way to see a roll, cancel, and
re-pull for a better one. Placing a rock is free, spends one of the five stamps, and
rolls one component of a random type at a random quality at the footprint where it
lands. The press is the only way a component enters the board (aside from a combine,
below).

- Type: uniform, 12.5% each (`1/8`), across the eight base component types:
  Capacitor, Coil, Emitter, Arc-Node, Discharge Rig, Choke, Rectifier, Regulator
  (`specs/towers.md`). The type roll is independent of your Refinement level.

- Quality: weighted low, and biased upward by your Refinement level (UPGRADE
  QUALITY, below). At Refinement R0 the press rolls only Scrap: every base component
  starts a run as crude salvage, and the whole quality ladder is climbed from there.
  Refining the press lifts the odds toward higher tiers, and at high Refinement a
  stamp can roll all the way up to Primed (T4) and, at the very top, Tesla-Prime
  (T5), but only rarely (the full odds tree is under UPGRADE QUALITY, below), so the
  apex is reached mostly by combining, occasionally by a lucky roll:

  | Quality | R0 odds |
  | --- | --- |
  | **Scrap** (T1) | 100% |
  | **Tuned** (T2) | 0% |
  | **Charged** (T3) | 0% |
  | **Primed** (T4) | 0% |
  | **Tesla-Prime** (T5) | 0% |

Type and quality roll independently. A stamp is free whatever it rolls; the press is
disabled only when the level's allowance is spent (`specs/gameplay.md`).

The current quality odds for the live Refinement level must be visible in the
scrap-press UI so the player can read the probability of each quality tier before
placing a rock, and see how buying UPGRADE QUALITY shifts them (`specs/board.md`,
`specs/controls.md`).

### Placement, continuous placement, and cancelling

A held rock is positioned on a legal 2×2 footprint the player snaps to the grid,
subject to the placement legality and never-seal rule of `specs/board.md` (a
placement that would fully block any waypoint segment, trap a unit, or land on a
waypoint-zone tile or a fixed housing is refused). Left-click a legal footprint to
drop it: it lands, rolls its component, becomes a candidate firing a build spark
effect (`specs/assets.md`), and the floor re-paths around its footprint.

- Continuous placement. Placing a rock does not clear your hand: if stamps remain,
  the press immediately arms another rock on the cursor, so you place five
  back-to-back without re-clicking STAMP each time. Placement ends when the allowance
  runs out, or you cancel.
- Cancel is free. Pressing `Esc` / right-click while holding a rock puts it away with
  no stamp consumed, because the roll only happens on a successful drop, so cancelling
  never wastes a build.
- Stamp onto a blocker. Dropping a rock onto an existing blocker's footprint rerolls
  that blocker into a fresh candidate (spending one stamp, still free). This is how
  you turn a wall you built earlier into a tower: spend a stamp on it, roll it, and
  keep it if it is good.

## KEEP — the one harvest per level (and it sends the wave)

After placing (up to five) candidates, the level's single harvest is a KEEP: the one
candidate you promote to a permanent firing component. There is no SEND button and no
deferred/reversible keep: committing the KEEP launches the wave immediately. Place
and compare all your rocks first, then commit the one you want.

- Select a candidate to inspect its rolled type, quality tier, and live stats
  (`specs/controls.md`), then click KEEP (or press `K`). The candidate becomes a
  permanent firing component, every other candidate hardens into a blocker, and the
  wave starts at once.
- Every level must harvest to advance; you cannot keep nothing. A level with no
  harvest would add no tower and could never begin its wave, so a KEEP (or a
  fresh-consuming COMBINE, below) is required each level. Placing rocks purely to
  extend the maze still happens (the four you don't harvest become blockers), but
  exactly one of the level's pieces is always harvested into a firing tower.

A COMBINE that folds in a fresh roll is also the harvest (below): it
resolves immediately when committed, stands up one permanent tower, and, because it
spends this phase's roll(s), is the level's one harvest and launches the wave on the
spot. Folding several rolls into one stronger tower is the point (a recipe assembled
entirely from this phase's rolls captures several rolls in a single harvested
tower), but the count of new towers per phase is always one. A plain COMBINE of only
standing towers is a different action (below): it is not a harvest and does not send
the wave.

### What happens at wave start

A build phase ends exactly one way: the level's harvest is committed (a KEEP, a
DOWNGRADE, or a fresh-consuming COMBINE), which launches the wave itself
(`specs/controls.md`). The resolution:

1. The harvest resolves into one permanent firing component: the kept candidate, or
   the combined tower.
2. Every remaining candidate hardens into a blocker, an inert wall for the rest of
   the run.
3. Any harvest state is cleared; the wave begins.

So each level adds exactly one new tower and leaves the rest of the level's rocks as
maze. The board's power comes from which single roll you harvest each level, climbing
the quality of your standing towers by combining them across the waves, assembling
combos, and lengthening the maze, never from keeping a whole level's worth of towers
untouched.

## Combining — two paths, immediate and any-time

There are two ways to combine: the quality-combine, which climbs the quality ladder,
and the recipe-combine, which assembles a combination tower. Both cost no Charge, and
both are wall-neutral: every footprint they consume hardens into a blocker rather
than being freed, so a combine never opens a hole in the maze (`specs/board.md`).

A combine resolves the instant you commit it, and what it consumes decides whether it
is the level's harvest (and so whether it sends the wave):

- Harvest combine, folds in `≥1` fresh roll, sends the wave. If any ingredient is a
  candidate placed this phase, the combine is the level's one harvest: it resolves,
  then launches the wave immediately, hardening every remaining candidate. A build
  phase can host only one such combine; the moment it fires, the wave begins.
- Plain COMBINE, folds only standing towers, leaves the phase running. If every
  ingredient is an existing standing component (no fresh candidate), the combine
  spends no roll and is not the harvest: it resolves and the build phase continues
  unchanged. This is the only combine allowed during a live wave, since candidates
  exist only in the build phase (KEEP, DOWNGRADE, DISMANTLE, and stamping are
  build-phase-only, `specs/controls.md`).
- The ingredients can be fresh candidates or standing components, in any mix, and the
  result lands at whichever piece you trigger the combine from, so a combine can
  replace an existing tower in place, not only a just-placed candidate. To fold a
  fresh roll into a standing tower and keep the tower where the maze already has it,
  trigger the combine from the standing tower. A mixed fold (a fresh candidate with
  standing towers) still consumes a fresh roll, so it is the harvest and sends the
  wave.
- Explicit selection. When you hold several copies of an ingredient a combine needs,
  you may shift-click the exact pieces to fold and combine that specific set. If you
  combine without an explicit multi-select, the game resolves the ingredients itself
  from the board (`specs/controls.md`).
- Auto-resolve prioritizes fresh rolls. When you commit a combine without
  shift-selecting the exact pieces, the game auto-picks the ingredients and always
  consumes a fresh candidate before a standing tower whenever both would satisfy the
  fold. Fresh rolls are expendable (an unkept candidate hardens into a blocker
  anyway), so spending them first preserves your invested towers, and it means an
  un-targeted fold of a fresh roll reliably resolves as the harvest that sends the
  wave. To fold specific standing towers instead (a plain COMBINE that keeps the
  phase open), shift-select them explicitly.
- Combinable pieces pulse at all times. Every base structure that could combine right
  now (it has a matching partner or completes a reachable recipe) pulses on the board
  unprompted, so you can see what is foldable without selecting anything; selecting a
  piece raises a brighter highlight on the exact set it would fold
  (`specs/controls.md`).

## Quality-combine — climb the quality ladder (fixed recipe)

Two matching components, the same TYPE and the same QUALITY, combine into one
component of that same type, one quality tier higher. This is the quality-combine,
and it resolves immediately when committed.

- Select a base structure (a candidate or an existing base component) whose type and
  quality match another candidate or base component anywhere on the board. The
  inspector then offers a quality-combine COMBINE (`specs/controls.md`); it is hidden
  when no match exists or when the piece is already Tesla-Prime.
- Committing it resolves at once: it produces the higher-tier component at the
  initiating piece's footprint and consumes the partner, but the partner's 2×2
  footprint hardens into an inert blocker rather than being freed, so the maze wall
  is preserved and a combine never opens a hole (`specs/board.md`, `specs/towers.md`).
  A quality-combine is therefore wall-neutral: both footprints stay walls. Because the
  result lands at the piece you triggered from, a combine can replace a standing tower
  in place.
- Quality-combining costs no Charge; the climb is paid in rolls, not money.
- A combine flash effect fires as the tier climbs (`specs/assets.md`), with a combine
  chime (`specs/assets.md`).

The recipe by rung (same type throughout):

| Combine | Produces |
| --- | --- |
| two **Scrap** (T1) | one **Tuned** (T2) |
| two **Tuned** (T2) | one **Charged** (T3) |
| two **Charged** (T3) | one **Primed** (T4) |
| two **Primed** (T4) | one **Tesla-Prime** (T5) |

Tesla-Prime (T5) is the apex and cannot combine further. Because the damage curve is
steep (`specs/towers.md`: `×3 / ×9 / ×40 / ×110` over Scrap), a combined component
always out-DPSes the two it consumed, and while a refined press can roll the top
tiers, it does so only rarely (`specs/build.md`: UPGRADE QUALITY), so combining is
the reliable way to stack the Primed and Tesla-Prime carries a recipe demands.
Combining a fresh candidate into an existing component is how you climb a standing
position: in the build phase it consumes a fresh roll, so it is the level's harvest
and sends the wave, while once the wave is live you climb your standing towers
against each other with the plain COMBINE.

A quality-combine only ever folds a same-type, same-quality pair; cross-type folding
belongs to the recipe-combine below, not here.

## Recipe-combine — assemble a combination tower

Beside the quality climb, the press feeds a second combine path: a recipe folds a
specific multiset of base `(type, quality)` ingredients into one unique combination
tower. This is the deep end of the build loop; combination towers are the strongest
structures in the game, and every one is a multi-level project to assemble.

- The recipe list is authoritative in `specs/towers.md`. There are twelve
  combination towers, each with a fixed recipe (an exact multiset of base `(type,
  quality)` ingredients), a fixed stat block, and its own ability loadout. Do not
  duplicate that table here; `specs/towers.md` owns the recipes and the combo stats.
  As illustration only: the early Static Web folds a Scrap Coil + Scrap Capacitor +
  Scrap Choke into a chaining, slowing tower, while the apex Aurora Lance demands a
  Tesla-Prime Choke + Primed Coil + Primed Discharge Rig.
- Ingredients come from the board. A recipe's ingredients may be candidates placed
  this level and/or existing base components already on the yard, in any mix, as long
  as their `(type, quality)` multiset exactly satisfies a recipe and includes the
  selected initiating piece. The inspector surfaces any recipe within reach and a
  `COMBINE SPECIAL → <combo name>` action (`specs/controls.md`). When you hold duplicate
  ingredients, shift-click the exact copies to choose which fold; otherwise the game
  picks them for you.
- It resolves immediately when committed, and its ingredients decide the phase.
  Clicking a `COMBINE SPECIAL → <combo name>` action resolves at once: the combination tower
  lands at the initiating piece's footprint (so it may replace a standing tower), and
  every consumed ingredient footprint hardens into an inert blocker, wall-neutral,
  never opening a hole (`specs/board.md`). If any ingredient is a fresh candidate, the
  recipe is the level's one harvest: it sends the wave, including the one-shot case
  where every ingredient was placed this phase, folding several fresh rolls into a
  single harvested combo. If every ingredient is a standing tower, it is a plain
  COMBINE that does not send the wave and may be done during a live wave.
- It costs no Charge; like every combine, the cost is paid in the rolls you fed it,
  not in money.
- A combo lands weak and is UPGRADED. A combination tower has no quality tier;
  instead it lands at upgrade level 0, a reduced fraction of its reference stat
  block, and is upgraded for Charge up to level 3 (`specs/towers.md`). This softens
  the power spike of landing a combo and makes it a Charge sink. A combo still cannot
  be quality-combined and cannot be fed into another recipe (it is not a base
  ingredient), and it still benefits from external buffs such as a Regulator's aura
  (`specs/towers.md`).
- Assembling a combo is a multi-level project. Because most recipes demand specific
  qualities (many call for Primed (T4) or Tesla-Prime (T5) ingredients, which the
  press rolls only at high Refinement and only rarely, `specs/build.md`), you must
  climb those ingredients up the quality ladder over several levels (refining the
  press toward the top tiers, quality-combining matches), stage them on the board, and
  only then fire the recipe. The apex combos are late-game payoffs planned many waves
  ahead; this is the strategic ceiling of the game.

## DOWNGRADE — KEEP a candidate one tier lower (sends the wave)

Refining the press biases every roll upward, which can leave you unable to produce a
low-tier ingredient a recipe still needs. DOWNGRADE is the fix: it is a KEEP at one
quality tier lower. Select a candidate at Tuned (T2) or above and harvest it as a
permanent firing component at `(tier − 1)`.

- Because it is the level's harvest, DOWNGRADE, like KEEP, sends the wave:
  the candidate becomes a standing component one tier lower and every other candidate
  hardens into a blocker. To then use the lowered tower as a recipe ingredient, fold
  it with a standing COMBINE during the wave (combining is allowed mid-wave), so
  nothing is lost by the wave starting.
- It applies only to candidates at Tuned (T2)+, this level's fresh rolls. A standing
  component (already committed), a combination tower (no quality tier), an inert
  blocker, and a Scrap (T1) candidate (already at the bottom) cannot be downgraded.
- It is build-phase only (candidates exist only then) and costs no Charge.
- Downgrading is a pure recipe-flexibility correction, a way to stand up the exact
  `(type, quality)` a recipe ingredient needs when your press has rolled too high.

## UPGRADE — climb a combination tower (any phase)

A combination tower lands weak, at upgrade level 0, and is climbed with Charge:

- Select a combination tower and UPGRADE it (`specs/controls.md`) to raise its level,
  up to level 3. Each level scales its damage (which carries through to its burn,
  crit, splash, and chain, all damage-derived) and nudges its range; the exact
  per-level numbers are in `specs/towers.md`.
- Each upgrade costs Charge scaled to the combo's strength (`specs/towers.md`), so a
  strong combo is a deeper sink. Upgrading is allowed in any phase, including during a
  live wave (like combining, and like UPGRADE QUALITY), so you can pour kill income
  into your firing line the moment it comes in and the affordance is always visible on
  a selected combo.
- A combo landing at full strength was too big a spike, so it lands reduced and is
  paid up over several build phases (and mid-wave), softening the curve and giving
  scarce kill income a meaningful place to go.

## UPGRADE QUALITY — the upgrade-chances track

The other place kill income goes is refining the press so it rolls stronger gems,
another progression axis beside combining. It raises the odds that a placed rock
rolls a higher-quality component.

- A run carries a Refinement level `R` on a nine-rung track R0 … R8 (starts at R0).
  Higher `R` biases the stamp's quality roll toward higher tiers; it does not change
  the uniform 12.5%-per-type roll, the stats, the combine recipes, or anything else.
  Each rung shifts about 10% of the probability up one quality level: a slice of the
  odds moves up the ladder.
- The build panel's UPGRADE QUALITY control (`specs/controls.md`, hotkey `U`) buys
  the next Refinement level for Charge, in any phase, including during a live wave (it
  only biases future rolls, so there is no reason to gate it). Hovering it shows the
  current odds; pressing it upgrades them. It is disabled at R8 or when you cannot
  afford the next cost. Refinement is permanent for the run.
- The top two tiers are rolled, not gifted. At high Refinement the press can roll
  Primed (T4) and, only at the very top rung, Tesla-Prime (T5), but sparingly: Primed
  first appears at R4 (10%) and Tesla-Prime only at R8 (10%). So a lucky apex roll is
  possible but rare, and combining stays the reliable way to stack the top-tier
  carries and recipe ingredients (`specs/towers.md`).

Quality odds by Refinement level (each row is a five-tier distribution over
Scrap…Tesla-Prime that sums to 1.0, fixed):

| R | Scrap T1 | Tuned T2 | Charged T3 | Primed T4 | Tesla T5 |
| --- | --- | --- | --- | --- | --- |
| **R0** | 1.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| **R1** | 0.70 | 0.30 | 0.00 | 0.00 | 0.00 |
| **R2** | 0.60 | 0.30 | 0.10 | 0.00 | 0.00 |
| **R3** | 0.50 | 0.30 | 0.20 | 0.00 | 0.00 |
| **R4** | 0.40 | 0.30 | 0.20 | 0.10 | 0.00 |
| **R5** | 0.30 | 0.30 | 0.30 | 0.10 | 0.00 |
| **R6** | 0.20 | 0.30 | 0.30 | 0.20 | 0.00 |
| **R7** | 0.10 | 0.30 | 0.30 | 0.30 | 0.00 |
| **R8** | 0.00 | 0.30 | 0.30 | 0.30 | 0.10 |

Refinement cost to reach each level (Charge, from the previous level), fixed. Each
step costs 30 Charge more than the last, and the whole climb from R0 to R8 totals
1000 Charge:

| Reach | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Cost** | 20 | 50 | 80 | 110 | 140 | 170 | 200 | 230 |

Refining and combining are complementary: refine so the press hands out more Charged
(and, at the top rungs, the occasional Primed / Tesla-Prime) base rolls, then combine
matched high-tier rolls into the specific carries and recipe ingredients a lucky roll
won't reliably hand you.

## How the loop drives the maze

Every rock you place, kept, combined, or not, walls its footprint, and a combine of
either kind keeps every consumed footprint walled (each hardens into a blocker), so
the only way to free a footprint is to dismantle a structure between waves
(`specs/towers.md`). So building always tends to lengthen the Load's route between
waypoints, never seal it (`specs/board.md`). Read the next-wave preview
(`specs/gameplay.md`), place your five rocks to both extend the maze and fish for a good
roll, then take the level's one harvest, which sends the wave itself: keep the roll
that best answers the coming wave (`specs/enemies.md`), or fold this phase's rolls
into a stronger tower with a COMBINE. Let
the rest harden into blockers, then, even as the wave runs, climb and assemble your
standing towers with the plain COMBINE and spend scarce Charge on UPGRADE QUALITY and
combo upgrades. That cycle, constrained by the 5-stamp allowance, the one-harvest
rule, and the never-seal rule, is the game.
