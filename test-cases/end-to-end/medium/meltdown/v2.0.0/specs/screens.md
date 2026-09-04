# Meltdown — Screens and menus

The game is on exactly one of eight screens at a time. This file defines what
each one draws and where each of its choices leads. `specs/controls.md` states
which key or press reaches each of them, and `specs/modes.md` the figures the two
choice screens set.

## Menus

Every menu is a vertical list of rows, and one row is highlighted, counted from
`0`. The highlighted row is drawn plainly apart from the others.

`up` and `down` move the highlight one row, and the highlight wraps at both ends:
moving down from the last row highlights the first, and moving up from the first
row highlights the last. This holds on every menu in the game. `confirm` takes
the highlighted row.

Every row is also a pointer target, as `specs/controls.md` states, so each of
these screens is navigable with the pointer alone and on a touchscreen. Where a
build draws a menu is its own choice, so the game reports each row's hit
rectangle as `menu` in the snapshot `specs/instrumentation.md` defines, in row
order. A row's rectangle is at least `MIN_TOUCH_TARGET` logical units tall and at
least `MIN_TOUCH_TARGET` wide, the figure `specs/hud.md` gives the panel's
controls, and no two rows of one menu overlap.

## What is highlighted on arrival

Every arrival at a screen sets the highlight, and the row it sets is fixed by the
screen arrived at and the screen come from. The general rule is that arriving at
a screen highlights its row `0`, and that returning to a screen highlights the
row that led away from it, so a player who steps into a screen and comes back
finds the highlight where they left it.

| Arriving at | Coming from | Highlighted row |
| --- | --- | --- |
| `title` | `howto` | `HOW TO PLAY`, row `1` |
| `title` | Anywhere else, and the game starting | `PLAY`, row `0` |
| `modeselect` | `difficultyselect` | `CONTAINMENT`, row `0` |
| `modeselect` | `title` | `CONTAINMENT`, row `0` |
| `difficultyselect` | `modeselect` | `EASY`, row `0` |
| `howto` | `title` | `BACK`, row `0` |
| `paused` | `playing` | `RESUME`, row `0` |
| `victory` or `gameover` | `playing` | `PLAY AGAIN`, row `0` |

`PLAY` is the row that led away from `title` toward every screen but `howto`, and
`CONTAINMENT` is the row that led away from `modeselect` toward
`difficultyselect`, so both cases follow the same rule as `howto` does.

## The eight screens

| Screen | What it is |
| --- | --- |
| `title` | The title and the main menu. |
| `modeselect` | The five modes. |
| `difficultyselect` | Containment's three difficulties. |
| `howto` | How the game is played. |
| `playing` | The floor and the build panel, in one of the three phases of `specs/waves.md`. |
| `paused` | The pause menu, over the frozen floor. |
| `victory` | The run won. |
| `gameover` | The run lost. |

## `title`

Draws `TITLE_TEXT` (`MELTDOWN`), `TAGLINE_TEXT` (`RUN IT HOT`), and the two rows
of `TITLE_ITEMS`, `PLAY` and `HOW TO PLAY`.

| Row | Where it leads |
| --- | --- |
| `PLAY` | `modeselect`. It starts no game of its own. |
| `HOW TO PLAY` | `howto`. |

`back` does nothing here. The title is where the game starts, and there is no
screen behind it.

## `modeselect`

Draws the six rows of `MODE_ITEMS`: `CONTAINMENT`, `THE HUNDRED`,
`DEEP POCKETS`, `BOTTLENECK`, `SUDDEN DEATH`, and `BACK`.

Each mode's description is readable before it is chosen: moving the highlight
across the five mode rows draws a different body of text for each, describing
what that mode is and what it changes, and moving the highlight starts nothing.
`BACK` names no mode and draws no description.

| Row | Where it leads |
| --- | --- |
| `CONTAINMENT` | `difficultyselect`. |
| `BACK` | `title`. |
| Any other row | `playing`, in the `opening` phase, on that mode. |

`back` returns to `title`, which is what `BACK` does.

## `difficultyselect`

Draws the four rows of `DIFFICULTY_ITEMS`: `EASY`, `MEDIUM`, `HARD`, and `BACK`.
Each of the three difficulty rows draws that difficulty's starting money and its
wave count, before it is chosen. `BACK` names no difficulty and draws no figures.

| Row | Where it leads |
| --- | --- |
| `BACK` | `modeselect`. |
| Any other row | `playing`, in the `opening` phase, on Containment at that difficulty. |

`back` returns to `modeselect`, which is what `BACK` does.

## `howto`

Covers the goal of the game, the controls, heat as power and the redline trip,
the Forge and the Sink, the heat-averse Rime, flyers and the air-only Flak, that
a Containment wave fields a single type, and the economy.

Draws the one row of `HOWTO_ITEMS`: `BACK`.

| Row | Where it leads |
| --- | --- |
| `BACK` | `title`. |

`back` returns to `title`, which is what `BACK` does.

## `playing`

The floor, the surge, the towers, and the build panel. `specs/waves.md` defines
its three phases and `specs/hud.md` the panel.

## `paused`

Draws the three rows of `PAUSE_ITEMS`: `RESUME`, `RESTART`, and `QUIT TO MENU`.
The floor is still drawn behind the menu.

| Row | Where it leads |
| --- | --- |
| `RESUME` | `playing`, with the floor exactly as it was left. |
| `RESTART` | A fresh run of the same mode and difficulty, from its `opening` phase. |
| `QUIT TO MENU` | `title`. |

`back` resumes, returning to `playing` with the floor exactly as it was left,
which is what `RESUME` does.

## `victory` and `gameover`

Both draw the two rows of `ENDING_ITEMS`, `PLAY AGAIN` and `MENU`.

| Screen | What it reports |
| --- | --- |
| `victory` | The final score, the waves survived, and the lives remaining. |
| `gameover` | The final score and the wave reached. |

| Row | Where it leads |
| --- | --- |
| `PLAY AGAIN` | A fresh run on the mode and difficulty the run just played, with that pair's starting money and lives. |
| `MENU` | `title`. |

`back` returns to `title` from either of them.
