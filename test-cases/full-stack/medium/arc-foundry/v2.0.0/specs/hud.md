# Arc Foundry — The status bar, the build panel, and the overlays

The heads-up display is the top status bar and the right build panel, in the regions
`specs/overview.md` fixes. Both are drawn in code, both are always fully visible, and
neither ever covers the yard. This file fixes what each carries, the two overlays the
status bar toggles, and what is drawn over the yard itself.

The bar and the panel are drawn on the two screens the yard is shown on, `playing` and
`paused`, and on no other screen. On `paused` both are drawn and both read their live
values, and every control on them is inert except the mute control, as
`specs/controls.md` states.

## The status bar

The status bar carries the run's state and the global controls, left to right in the
order below.

| Element        | Shows                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| Charge         | The current spendable Charge, with an icon.                                                           |
| Grid Integrity | The remaining Grid Integrity, with an icon. It reads as an alert once it falls to `5` or below.       |
| Wave           | `WAVE n / N`, with the current wave's progress during a wave and a `BUILD` read during a build phase. |
| Maze length    | The current maze length, in tiles, as `specs/pathing.md` defines it.                                  |
| Combos toggle  | Opens and closes the recipe book, and reads its open state.                                           |
| Damage toggle  | Opens and closes the damage leaderboard, and reads its open state.                                    |
| Speed          | The current speed multiplier, one of `1`, `2`, `4`, `8`.                                              |
| Pause          | The in-place pause, and whether it is engaged.                                                        |
| Mute           | Audio mute, and whether it is engaged.                                                                |

The speed, pause, and mute controls each read their own current value rather than merely
being clickable, so what the bar draws changes when the value changes. Muting from the
bar or from the keyboard changes what the bar draws.

Three further reads sit in the bar:

- A clear `PAUSED` read shows while the game is paused in place.
- An `OVERLOAD` read shows during the finale, with the Maze Rating accruing live.
- The maze length updates the instant a placement or a dismantle changes the route.
  Hovering it draws the full ground route on the yard, from the entry through every
  waypoint to the collector. Flying units ignore the maze, so neither the figure nor the
  drawn route covers them.

There is no score readout. The run keeps no running score.

## The build panel

The build panel holds, top to bottom:

1. The quality-roll odds at the live refinement level, so the player reads the
   probability of each of the five tiers before placing a rock.
2. The refinement control: the current level `R`, and the Charge cost of the next level.
   It is disabled at `R8` and when the next level is unaffordable, and by nothing else.
   Activating it refines the press whatever is selected. It is the press's own control
   and never the inspector's `UPGRADE`, so the two are activated separately and one is
   never reached by activating the other.
3. The press control: `STAMP`, showing that placement is free and how many of the level's
   `5` stamps remain. It is disabled when the allowance is spent and during a wave.
4. The inspector, when a structure is selected.
5. The next-wave preview, when nothing is selected.
6. The harvest prompt: a non-clickable line reading that committing a harvest starts the
   wave. It reads `KEEP OR COMBINE A ROLL TO SEND` during a build phase after wave `1`,
   and `KEEP OR COMBINE A ROLL TO START` before wave `1`.

There is no send control and no separate harvest button.

### The inspector

The inspector shows what the selected structure is and the actions it offers.

| Selected                      | Reads                                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A base candidate or component | Its type, its quality tier, a one-line description, and its live damage, range, fire rate, and targeting priority, plus its kills and total damage dealt when it fires. |
| A Regulator                   | Its type, its quality tier, and its aura radius and bonus in place of damage, range, and fire rate. It shows no targeting priority.                                     |
| A combination tower           | Its name, its upgrade level, its one-line description, its live damage, range, fire rate, targeting priority, and abilities, and its kills and total damage dealt.      |
| A blocker                     | That it is inert, with no stats.                                                                                                                                        |

The actions the inspector offers are `KEEP`, `DOWNGRADE`, `COMBINE`, one
`COMBINE SPECIAL` per reachable recipe, `UPGRADE`, the targeting cycle, and `DISMANTLE`.
`specs/controls.md` fixes what each does and when each is available.

### The action controls hold fixed slots

Every action the selected structure can ever offer is drawn for as long as that structure
stays selected, each in its own slot, in a fixed order. An action that is unavailable
right now is drawn disabled in its slot, visibly inert and ignoring clicks, rather than
hidden, removed, or collapsed, and the controls around it do not close the gap.

No change in game state adds, removes, resizes, or moves a control. A wave starting or
ending, Charge accruing or being spent, a combinable partner appearing on the yard, and a
candidate reaching the top of the quality ladder all leave the panel's geometry untouched
and change only which controls are enabled.

The panel's layout changes only when the player causes it: selecting a different
structure, deselecting, or opening an overlay. Two actions are absent rather than
disabled, because the selected structure has no priority to cycle at all:

- A candidate has no targeting control, at any type or tier, because a candidate does not
  fire.
- A Regulator has no targeting control, at any tier, whether a candidate or a component.

A blocker offers `DISMANTLE` alone.

### The next-wave preview

With nothing selected, the panel shows the coming wave's unit types. Pointing at a type
floats a tooltip describing that type.

## The recipe book

The recipe book is a read-only overlay listing all twelve combination towers, each with
its exact recipe and its headline stats, and a plain-language description shown at least
on hover. It does not pause or alter the game, and toggling it again dismisses it.

Every ingredient of every recipe is drawn in one of three states, told apart at a glance:

| State    | When it applies                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------- |
| Selected | The current selection is a base structure at that ingredient's type and quality.                         |
| Owned    | The yard holds a base structure at that ingredient's type and quality that is not the current selection. |
| Missing  | Neither of the above.                                                                                    |

Ownership counts as a multiset, so a recipe calling for two ingredients at the same type
and quality reads as covered only when the yard holds two. Blockers and combination
towers are never ingredients and never count as owned. A recipe that would consume the
current selection is emphasized as a whole.

## The damage leaderboard

The damage leaderboard is a read-only overlay ranking the player's firing structures by
total damage dealt, updating live as a wave runs, and showing each structure's kills.
Pointing at a row spotlights that structure on the yard: every other piece is drawn
desaturated so the ranked structure is unmistakable. It does not pause or alter the game,
and toggling it again dismisses it.

## What the yard itself draws

The yard carries no persistent panels or chrome. Over the map and its structures it draws
only:

- Each unit's health bar.
- The held rock's footprint, snapped to the grid, with its legal or illegal read.
- The range ring of the held or selected structure.
- The mark on every base structure that could combine right now, and the stronger mark on
  the exact set the current selection would fold.
- The waypoint order numbers, drawn over everything else.
- Projectiles and effects.
