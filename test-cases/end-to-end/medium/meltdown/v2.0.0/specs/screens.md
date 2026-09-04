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
these screens is navigable with the pointer alone and on a touchscreen.

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

Draws the five rows of `MODE_ITEMS`: `CONTAINMENT`, `THE HUNDRED`,
`DEEP POCKETS`, `BOTTLENECK`, and `SUDDEN DEATH`.

Each mode's description is readable before it is chosen: moving the highlight
across the five rows draws a different body of text for each, describing what
that mode is and what it changes, and moving the highlight starts nothing.

| Row | Where it leads |
| --- | --- |
| `CONTAINMENT` | `difficultyselect`. |
| Any other row | `playing`, in the `opening` phase, on that mode. |

`back` returns to `title`.

## `difficultyselect`

Draws the three rows of `DIFFICULTY_ITEMS`: `EASY`, `MEDIUM`, and `HARD`. Each
row draws that difficulty's starting money and its wave count, before it is
chosen.

Confirming a row opens `playing` in the `opening` phase, on Containment at that
difficulty. `back` returns to `modeselect`.

## `howto`

Covers the goal of the game, the controls, heat as power and the redline trip,
the Forge and the Sink, the heat-averse Rime, flyers and the air-only Flak, that
a Containment wave fields a single type, and the economy.

`back` returns to `title`.

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

Both draw the two rows of `ENDING_ITEMS`, `PLAY AGAIN` and `MENU`, and both open
with the highlight on `PLAY AGAIN`, at row `0`.

| Screen | What it reports |
| --- | --- |
| `victory` | The final score, the waves survived, and the lives remaining. |
| `gameover` | The final score and the wave reached. |

| Row | Where it leads |
| --- | --- |
| `PLAY AGAIN` | A fresh run on the mode and difficulty the run just played, with that pair's starting money and lives. |
| `MENU` | `title`. |

`back` returns to `title` from either of them.
