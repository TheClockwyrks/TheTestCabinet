# Deepcore — Screens, menus, and the status bar

This file defines the game's screens and how a player moves between them, the
menus and building panels, and the status bar shown while mining. Every figure and
every piece of screen copy below carries the name this specification gives it. The
content and the navigation are fixed; the layout is yours.

## Screens

The game is a small state machine, and the state it is in has one of these names.

| Screen | Shows |
| --- | --- |
| `title` | The title `TITLE_TEXT` (`DEEPCORE`), a tagline, and the main menu. |
| `mode-select` | The choice of mode, with each mode's death rule. |
| `size-select` | The choice of world size, with each size's Core depth. |
| `how-to-play` | How the game is played. |
| `in-mine` | The live game: the world through the camera, the miner, and the status bar. |
| `paused` | The pause menu over the frozen, dimmed world. |
| `victory` | The run summary, after the rocket launches. |
| `game-over` | The run summary, after a death. |

`in-mine` covers the surface and the whole descent; what changes between them is
the camera and whichever panel is open.

## Menus

The highlighted item is drawn distinctly from the others.

| Screen | Items | Navigation |
| --- | --- | --- |
| `title` | `TITLE_ITEMS`: `CONTINUE` (present only while a save exists, and first when present), `NEW EXPEDITION`, `HOW TO PLAY` | `CONTINUE` resumes the save into `in-mine`; `NEW EXPEDITION` goes to `mode-select`; `HOW TO PLAY` goes to `how-to-play`. |
| `mode-select` | `MODE_ITEMS`: `STANDARD`, `HARDCORE`, `BACK` | A mode goes to `size-select`; `BACK` returns to `title`. |
| `size-select` | `SIZE_ITEMS`: `QUICK`, `STANDARD`, `MARATHON`, `BACK` | A size begins the expedition in the mode chosen at `mode-select`; `BACK` returns to `mode-select`. |
| `how-to-play` | — | Returns to `title`. |
| `paused` | `PAUSE_ITEMS`: `RESUME`, `RESTART`, `QUIT TO MENU` | `RESTART` starts a fresh expedition in the same mode and size; `QUIT TO MENU` returns to `title`. |
| `victory` | `VICTORY_ITEMS`: `PLAY AGAIN`, `MENU` | `PLAY AGAIN` starts a fresh expedition in the same mode and size. |
| `game-over` | `GAME_OVER_SAVE_ITEMS`: `CONTINUE FROM SAVE`, `MENU` in Standard while a save exists; otherwise `GAME_OVER_ITEMS`: `PLAY AGAIN`, `MENU` | `CONTINUE FROM SAVE` restores the save into `in-mine`. |

`mode-select` shows each mode's death rule before it is chosen, and `size-select`
shows each size's Core depth in metres before it is chosen.

`how-to-play` covers the goal of building and launching the rocket, the controls,
the dig-sell-upgrade loop, that the drill cuts down, left, and right but never up,
fuel and the climb home, the cargo's slots and its weight, the hazards, the
materials and the scanner, saving, and the two modes.

## Building panels

Each panel opens when the miner activates its building and closes back to the
mine. The Save Pad has no panel; activating it saves directly.

| Panel | Contents |
| --- | --- |
| `fuel-depot` | Buying fuel and hull repair, by the fixed increment and to full. |
| `ore-market` | The cargo broken down by ore with counts and total, and `SELL`. |
| `upgrade-shop` | The seven tracks, each with its current tier, the next tier's effect, and its price. |
| `supply-depot` | The six field supplies, each with its icon, price, and held count, and a buy control. |
| `launch-pad` | The five-component rocket checklist, and `FABRICATE` or `LAUNCH`. |
| `inventory` | The held ore with counts and weights, the slots and load readout, a drop control per ore, the materials satchel, and the field supplies with a `USE` control each, plus `JETTISON` while a Core Sample is carried. |

`inventory` opens anywhere; the other five open only at their buildings. Every
panel and menu is fully operable with the mouse, with the keyboard bindings as an
alternative.

## The status bar

The status bar occupies `y` in `[0, HUD_H]` and is always fully visible while
`in-mine`. It shows:

- the fuel gauge, taking the alert treatment below `LOW_FUEL_FRACTION`;
- the hull gauge, taking the alert treatment below `LOW_HULL_FRACTION`;
- the cargo, as slots used over capacity with the load in kilograms alongside,
  taking the alert treatment while the bay is full and reading `OVERLOAD` while
  the load fraction is `1` or more;
- the Credits;
- the depth in metres;
- the materials satchel, showing which of Resonite and Cryenite is held;
- the inventory, pause, and mute controls.

A player reads the fuel and hull remaining, how full the cargo is, the depth, and,
on a core run, the seconds left, without hunting for any of them.

## Drawn over the world

- The scanner indicator: a direction to the locked material and a distance, drawn
  only while the scanner is locked on. Nothing is drawn when nothing is locked.
- The Core Sample countdown, drawn prominently while a Sample is carried, with its
  escalating alarm cue and a jettison hint. A jettisoned Sample shows its
  countdown over its ground cell instead.
- The first-time hazard notice card, non-blocking and self-fading.

## Out of scope

- Networking, online play, and any account-based or cloud progress. The single
  local save is the whole of persistence.
- Touch and gamepad input. Mouse and keyboard only.
- Combat and enemies of any kind.
- Selling fuel or hull back for Credits.
- Any ore, material, hazard, building, or upgrade track beyond those specified.
