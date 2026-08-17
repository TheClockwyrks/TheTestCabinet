# Arc Foundry — UI: game states, menus, and the HUD

This file defines the game's screens — the state machine that moves between them and
the required menus — the heads-up display shown during a match, and what is out of
scope. It refers to the controls in `specs/controls.md`, the yard and its regions in
`specs/board.md`, the map and difficulty menus in `specs/modes.md`, the components in
`specs/towers.md`, the produced art in `specs/assets.md`, and the economy, campaign,
and maze rating in `specs/gameplay.md`.

## Game states

The game is a small state machine. Each state has a clear screen and controls
(controls are defined in `specs/controls.md`).

1. Title / main menu. Shows the title `ARC FOUNDRY`, a tagline, and a vertical menu
   listing the SALVAGE campaign start followed by HOW TO PLAY. The selected item is
   highlighted. A dim slice of a live yard may show behind the menu for atmosphere.
2. Map select. Reached from SALVAGE on the main menu. Lists the three maps
   (`specs/board.md`), The Substation, The Switchyard, and The Transformer Yard, each
   showing its name and a small preview of its waypoint layout (and Map C's fixed
   housings) so the player can read the maze it poses before choosing. Choosing a map
   advances to Difficulty select; a BACK choice returns to the main menu.
3. Difficulty select. Reached from map select. Lists the three difficulties, Easy,
   Medium, Hard (`specs/modes.md`), each showing what it changes (its wave count and
   its enemy toughness) before it is chosen. Selecting one begins the campaign on the
   chosen map at that difficulty; a BACK choice returns to map select.
4. How to play. Describes the goal (stop the Load from reaching the Collector), the
   controls, the scrap-press build (place a rock that rolls a random component on
   placement), the keep exactly one per level rule and that every other rock hardens
   into an inert blocker, combining a match up the quality ladder, UPGRADE QUALITY
   (refining the press for better rolls), that every rock and component is also a wall
   and you build the maze, the ordered waypoints and their platforms, the flyer that
   appears every four waves and ignores the maze, and the economy and Grid Integrity.
   Returns to the main menu.
5. In match. The live game: the chosen map's yard and its maze, the Load walking and
   flying, the components firing, and the build panel. This covers both the untimed
   build phase (no Load spawning; you build) and the wave phase (Load active; building
   is disabled, `specs/controls.md`). Play can be paused in place here: ticks freeze
   while the board stays visible, with no menu over it and a clear `PAUSED` read, via
   the status-bar pause control or the pause hotkey (`specs/controls.md`).
6. Paused. The `Esc` overlay menu, reachable in match. Offers Resume, Restart, and
   Quit to menu. The yard is visible but frozen behind the menu. This is separate from
   the in-place pause of state 5: the menu freezes the game and covers it, whereas the
   in-place pause freezes the game but keeps it playable.
7. Victory. Shown after the final wave is cleared and the post-final maze-rating
   finale has run (`specs/gameplay.md`). Displays the Maze Rating (the total damage the
   maze dealt to the invincible Overload Dynamo), waves survived (all `N`), and Grid
   Integrity remaining, with PLAY AGAIN and MENU.
8. Overload. Shown when Grid Integrity reaches `0`. Displays the wave reached (there
   is no Maze Rating, since the finale is never reached) with PLAY AGAIN (or TRY
   AGAIN) and MENU.

## Required menus

Every menu and screen below must be present and reachable. Each entry states its
content (what must appear) and its navigation (where its choices lead); the visual
layout, styling, and interaction details are yours, subject to the palette and type
of `specs/overview.md`. The map and difficulty content is in `specs/modes.md` and
`specs/board.md`.

- Main menu: the title, a tagline, the SALVAGE start, then HOW TO PLAY. SALVAGE → map
  select; HOW TO PLAY → the how-to-play screen.
- Map select: an entry for each of the three maps, each with its name and a preview of
  its waypoint layout (`specs/board.md`); choosing one → difficulty select; BACK → the
  main menu.
- Difficulty select: an entry for Easy, Medium, and Hard, each showing its wave count
  and enemy toughness before selection (`specs/modes.md`); choosing one → begins the
  campaign on the chosen map at that difficulty; BACK → map select.
- How to play: the goal, the controls, the scrap-press build and the fates of a rock,
  the maze-and-waypoints model, and the economy; a way back to the main menu.
- Pause menu: Resume, Restart, and Quit to menu, over the frozen yard.
- Victory screen and Overload screen: the end-of-game results with PLAY AGAIN and
  MENU. PLAY AGAIN replays the campaign on the same map and difficulty; MENU returns
  to the main menu.

Every menu must be fully operable with the mouse alone, with the keyboard
accelerators of `specs/controls.md` as an alternative. This specification fixes the
content and navigation of these menus, not their layout or presentation.

## HUD

The HUD is the top status bar and the right build panel (`specs/board.md`), drawn in
code (`specs/assets.md`; only their small icons may be produced sprites), always
fully visible:

- Status bar (`y` in `[0, 56]`): Charge, Grid Integrity (turning to the alert color
  as it runs low), the wave indicator `WAVE n / N` with the current wave's progress or
  a BUILD read between waves (the phase is untimed), and the speed, pause, and mute
  controls. Each of those three reads its own CURRENT STATE at a glance, so the bar
  shows what the game is doing and not merely what can be clicked: the speed control
  reads the live multiplier, and the pause and mute controls each look visibly
  different while paused and while muted than they do otherwise. Muting from the
  status bar or with `M` (`specs/controls.md`) must therefore change what the bar
  draws. There is no score readout; the run keeps no running score. A clear `PAUSED`
  read shows while paused in place; during the post-final finale the bar reads
  OVERLOAD and shows the Maze Rating accruing live on the invincible boss.
- Build panel (`x` in `[1000, 1280]`), top to bottom: the quality-roll odds at the
  live Refinement level; the UPGRADE QUALITY control (the current Refinement level `R`
  and the next level's cost, `specs/build.md`); the scrap-press control (STAMP,
  showing that placement is free and the remaining stamps of the `5`-per-level
  allowance); the selected candidate/component inspector (its type, quality tier, live
  stats — damage, range, fire rate, targeting; a combination tower instead reads its
  upgrade level and abilities, and a Regulator reads an aura radius/bonus readout since
  it does not fire, `specs/towers.md`) and its action controls: KEEP (a candidate,
  harvest that sends the wave, build phase), COMBINE (a quality match or a reachable
  combination-tower recipe, immediate, any time), DOWNGRADE (a candidate harvested one
  quality tier lower, harvest that sends the wave, build phase), UPGRADE (a selected
  combination tower's level, any phase),
  and targeting (`specs/build.md`, `specs/controls.md`); and the next-wave preview (the
  coming wave's types, shown when nothing is selected). There is no SEND button and no
  bottom harvest prompt; committing the level's harvest (a KEEP, DOWNGRADE, or
  fresh-consuming COMBINE) is what launches the wave. The speed toggle
  (`1×`/`2×`/`4×`/`8×`), wave indicator, and wave progress live in the status bar.

On the board, each unit carries a health bar (`specs/enemies.md`), each component and
candidate reads as its type and quality tier (its finish and effects escalate by tier,
`specs/towers.md`), a blocker reads as an inert rock, and a selected or held piece
shows its range ring. A player must be able to read, without hunting, how much Charge
they have, how close Grid Integrity is to zero, which wave is coming and what it
contains, and each board component's type and quality, at fast speed.

## Out of scope

- Network or online multiplayer, and any saved/persisted progress between sessions.
- Touch or gamepad input (mouse and keyboard only for this version).
- A map editor or procedurally generated yards: the maps are the fixed, hand-authored
  set of `specs/board.md` (the player chooses among the three at map select, but cannot
  edit or generate one).
- An in-run research or tech tree beyond the quality-ladder climb of `specs/build.md`
  and the per-component targeting of `specs/towers.md`.
- Any Load form, component type, quality tier, or mechanic beyond those specified
  here; keep the scope to the systems above, done well.
