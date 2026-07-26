# Gameplay — economy, integrity, the campaign, and the maze rating

This file defines the economy (Charge), Grid Integrity and leaks, the wave campaign
and victory/overload, the post-final maze rating, the SALVAGE campaign start, and the
behaviors that make good targets. The game's state machine, the required menus, the
HUD's meaning, and what is out of scope now live in `specs/ui.md`. It refers to the
yard and its regions (`specs/board.md`), the Load (`specs/enemies.md`), the components
(`specs/towers.md`), the scrap-press build loop (`specs/build.md`), the controls
(`specs/controls.md`), and the difficulty and map menus (`specs/modes.md`).

The numeric values here are fixed; implement them exactly as written, except the
wave count and the enemy HP scaling, which `specs/modes.md` sets per difficulty.
Every value in this file is constant across difficulty; only the wave count and enemy
toughness change.

## The SALVAGE campaign start

The game has one campaign start, SALVAGE, listed on the main menu before HOW TO
PLAY. Choosing it opens the map select (`specs/board.md`), where you pick which yard
to defend (The Substation, The Switchyard, or The Transformer Yard), and then the
difficulty select (`specs/modes.md`), where you pick Easy, Medium, or Hard. You then
begin with a starting Charge of `10` and a starting Grid Integrity of `20`, and play
the chosen difficulty's full wave run on that map: stamp components from the
scrap-press, wall the yard into a maze, and burn the Load down before it reaches the
Collector, spending Charge across the escalating waves, until you either clear the
final wave with Grid Integrity to spare (victory) or Grid Integrity reaches `0`
(overload). Placing rocks is free, so the opening build phase is the first real
layout decision regardless of the thin `10` opening Charge. The start uses every
system exactly as the specs define it, with no overrides beyond the chosen
difficulty's wave count and enemy toughness (`specs/modes.md`).

## Charge and the economy

Charge is the currency, scavenged power spent to UPGRADE QUALITY and to upgrade
combination towers, and recovered from kill bounties and the wave-clear bonus.
Placing rocks at the scrap-press is free; Charge is deliberately scarce: bounties are
thin, there is no interest, and the wave-clear bonus is small, so every upgrade is a
real decision.

- Starting Charge is `10`, a thin opening reserve, not a war chest; a first
  Refinement (`R0 → R1`, `20` Charge) must be earned from the opening waves.
- Kill bounty. Killing a Load unit pays its bounty (`specs/enemies.md`) the moment it
  is removed. Bounties are small (a basic unit pays `1` Charge), so kill income is
  thin.
- Wave-clear bonus. Clearing a wave (its last unit dies or leaks) pays a small flat
  bonus that starts at about `10` Charge on Wave 1 and grows only gently with the
  wave number (the reference build pays `8 + 2 × waveNumber`).
- No interest. Charge does not accrue interest; banking is not rewarded, so the only
  income is kill bounties and the wave-clear bonus.
- Spending. Charge is spent on two things: UPGRADE QUALITY and upgrading combination
  towers. Placing rocks is free (a rock rolls one component where it lands, up to the
  `5`-per-level allowance, and costs no Charge, `specs/build.md`), so the press is
  disabled only when the allowance is spent. UPGRADE QUALITY buys the next Refinement
  level for its fixed cost (`20 / 50 / 80 / 110 / 140 / 170 / 200 / 230` up the R1–R8
  track, `specs/build.md`). Upgrading a combination tower raises its level for a
  Charge cost that scales with the combo's strength (`specs/towers.md`). Placing,
  combining, and downgrading cost nothing. There is no selling; nothing you place is
  ever refunded for Charge, so the only Charge sinks are refinement and combo
  upgrades. You may dismantle a misplaced structure between waves as a correction, but
  it returns nothing, no stamp, ever (a refund would let you re-roll the press for
  free, `specs/towers.md`).

## Grid Integrity and leaks

- You start with `20` Grid Integrity.
- When a Load unit reaches the Collector (`specs/board.md`) it grounds out (leaks),
  costing its leak value in integrity (`specs/enemies.md`: most units `1`, a Slug
  `2`, and the Dynamo boss `5`) and is removed, with a leak-alarm effect and sound
  (`specs/assets.md`).
- Integrity never regenerates. If integrity reaches `0` or below, the grid overloads
  and the game ends (the Overload state, `specs/ui.md`), even mid-wave.

## The wave campaign and victory

- A run is a fixed sequence of `N` waves on the map the player chose at the
  map-select screen (`specs/board.md`), where `N` is set by the selected difficulty
  (`specs/modes.md`); the reference Medium run is `50`. Waves are numbered `WAVE 1` …
  `WAVE N`.
- Between waves there is an untimed build phase, during which the Load is not
  spawning and you place rocks, keep, combine, downgrade, and upgrade
  (`specs/build.md`). It shows no countdown and never starts on its own. There is no
  SEND control: the player re-shapes the maze at leisure, then commits the level's
  one harvest, which starts the next wave itself. The harvest is a KEEP (a rolled
  candidate becomes a permanent firing component), a DOWNGRADE (the same, one quality
  tier lower), or a COMBINE that spends a fresh roll; whichever it is, every other
  rock hardens into a blocker and the wave begins. Every level must harvest exactly
  one new tower to advance; there is no keep-nothing level. A plain COMBINE of only
  standing towers is immediate, is not a harvest, and may be taken at will during the
  build phase and during a live wave (`specs/build.md`).
- The opening build phase, before Wave 1, is also untimed. The build panel's prompt
  reads …TO START there (rather than …TO SEND), but the mechanic is the same: the
  first harvest launches Wave 1. Placing rocks is free, so the opening build phase
  lays the first partial maze regardless of the thin `10` opening Charge.
- Pulling the press, keeping, and downgrading are allowed only during the
  build phase, never during a live wave, subject to the fixed allowance of `5` rock
  stamps per level (`specs/build.md`). Combining standing towers, UPGRADE QUALITY, and
  upgrading a combination tower are allowed in any phase, including mid-wave. There is
  no build-phase timer and no early-send bonus.
- During a wave, the Load spawns from the map's Entry over time (the exact timing and
  per-wave mix are specified in `specs/enemies.md`). A wave is cleared when every unit
  it released has either died or leaked. Clearing a wave pays its bonus and opens the
  next build phase.
- Milestone waves. A Dynamo boss (`specs/enemies.md`) anchors two waves: the final
  wave (Wave `N`) always, and one midpoint wave (`round(N / 2)`) always. In the
  reference `50`-wave Medium run these are Wave `25` and Wave `50`.
- Difficulty scaling. Only the wave count `N` and the enemy HP scaling change with
  difficulty (`specs/modes.md`). A unit's HP on wave `w` is its base HP
  (`specs/enemies.md`) times `baseMult × [ (1 + k × (w − 1)) + c × (r^(w − 1) − 1) ]`,
  a linear opening/mid ramp (`k`) plus a late-game exponential surcharge (`c`, `r`)
  that is `0` at wave 1 and dominates the back third, where `baseMult`, `k`, `c`, `r`
  are the difficulty's constants (Medium `0.22`, `1.17`, `0.18`, `1.13`). Speeds,
  bounties, and leak values do not scale, and every component stat is unchanged across
  waves; only the Load grows.
- Victory. Clearing the final wave (Wave `N`) with Grid Integrity remaining wins the
  game. Before the Victory screen (`specs/ui.md`), the post-final maze-rating finale
  (below) runs: the game already counts the run as won, and the finale only measures
  how good the maze is.
- Overload (defeat). Grid Integrity reaching `0` ends the game (the Overload state,
  `specs/ui.md`), even mid-wave.

## The post-final maze rating (the run's only score)

The run keeps no running score. Grid Integrity only decides win/lose; it is never
scored. The run's one end-of-run number is the Maze Rating, and it is produced by a
short finale after the final wave is cleared:

- When Wave `N` is cleared, a single Overload Dynamo, an invincible boss
  (`specs/enemies.md`), spawns at the Entry and walks the maze once, from the Entry
  through the ordered waypoint chain to the Collector, exactly like any ground unit
  (it takes the shortest open route around your walls).
- It cannot be killed: every shot's full damage is tallied into the Maze Rating
  instead of removing HP, and it still takes slow and burn (which keep it under fire
  longer). When it grounds out at the Collector it costs no integrity (the run is
  already won), and the game advances to the Victory screen.
- The Maze Rating is that total damage: a direct measure of how much damage the
  player's maze can deal. A longer maze holds the boss under fire longer, and a
  stronger, better-placed firing line deals more per second, so the rating rewards
  both firepower and maze length. It shows on the Victory screen and is not persisted
  between sessions. A defeat never reaches the finale, so it has no Maze Rating.

## Key behaviors

The game must exhibit these behaviors. They are observable:

- The campaign begins at MAP SELECT where the player picks one of three maps, then a
  DIFFICULTY SELECT where they pick Easy / Medium / Hard, and plays the run on that map
  at that difficulty (`specs/board.md`, `specs/modes.md`).
- Difficulty changes only wave count and enemy toughness. Starting Charge (`10`), Grid
  Integrity (`20`), builds-per-level (`5`, placement free), the Refinement track, the
  roster, and every economy value are identical on Easy / Medium / Hard
  (`specs/modes.md`).
- Every rock and component is also a wall and you build the maze: the Load traverses
  its map's ordered waypoints (each a 4-tile platform), taking the shortest open route
  between consecutive waypoints, and building lengthens the route; a placement that
  would seal any segment, or land on a waypoint platform, is refused, and the floor
  re-paths as walls change — which, placement and dismantling both being
  build-phase-only, never happens under a walking unit (`specs/board.md`).
- The scrap-press places a rock that rolls a random component type at a random quality
  on placement (biased upward by Refinement); each level yields exactly one new firing
  component and every other un-harvested rock hardens into an inert blocker. There is
  no SEND: committing that one harvest starts the wave, and every level must harvest.
  The harvest is a KEEP, a DOWNGRADE (the same, one quality tier lower), or a COMBINE
  that folds in a fresh roll (a quality
  match, same type + quality → one tier higher, or a combination-tower recipe). A plain
  COMBINE of only standing towers is immediate, is not a harvest, and is taken at will
  in the build phase and during a live wave; that is how a player climbs and assembles
  their board across the waves. You may also downgrade a candidate (build phase) and
  upgrade a combination tower or refine the press in any phase (`specs/build.md`,
  `specs/towers.md`).
- Components fire automatically at valid in-range units with selectable targeting,
  throwing visible traveling arcs that carry the hit. The Regulator is the one
  exception, a non-firing support type that projects a buff aura instead
  (`specs/towers.md`); flyers (every fourth wave) ignore the maze but can still be hit
  in range (`specs/towers.md`, `specs/enemies.md`).
- The economy runs on thin kill bounties and a small wave-clear bonus (no interest)
  spent on UPGRADE QUALITY and combo upgrades (no selling); a leak costs Grid
  Integrity; `0` integrity overloads and ends the game; clearing the final wave with
  integrity left wins it (this file).
- There is no running score. After the final wave, an invincible Overload Dynamo walks
  the maze once and the total damage dealt to it is the run's Maze Rating, shown at
  Victory; a defeat has no rating, and Grid Integrity only gates win/lose (this file).
- A Dynamo boss anchors the milestone waves (`round(N / 2)` and Wave `N`), seething
  and bursting into a big discharge on death; a final invincible Overload Dynamo runs
  the post-final maze-rating finale (`specs/enemies.md`, `specs/assets.md`).
- The game can be paused in place (status-bar pause or the pause hotkey during a
  wave): ticks freeze so you can read the frozen board, with no menu shown. `Esc`
  instead opens the pause menu, which also freezes the game (`specs/controls.md`).
- The component and Load sprites, the enemy and boss animations, the electrical
  particle effects (arcs, chain-lightning, spark showers, discharges), and the audio
  are all produced with the on-`PATH` tools and wired in (`specs/assets.md`).
