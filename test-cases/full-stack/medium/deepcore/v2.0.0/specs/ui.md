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
| `victory` | The expedition summary, after the rocket launches. |
| `game-over` | The expedition summary, after a death. |

`in-mine` covers the surface and the whole descent; what changes between them is
the camera and whichever panel is open.

## Menus

The highlighted item is drawn distinctly from the others. `menuIndex` names it,
counted from `0` over the items the screen shows.

| Screen | Items |
| --- | --- |
| `title` | `TITLE_ITEMS`: `CONTINUE` (present only while a save exists, and first when present), `NEW EXPEDITION`, `HOW TO PLAY` |
| `mode-select` | `MODE_ITEMS`: `STANDARD`, `HARDCORE`, `BACK` |
| `size-select` | `SIZE_ITEMS`: `QUICK`, `STANDARD`, `MARATHON`, `BACK` |
| `how-to-play` | `HOW_TO_PLAY_ITEMS`: `BACK` |
| `paused` | `PAUSE_ITEMS`: `RESUME`, `RESTART`, `QUIT TO MENU` |
| `victory` | `VICTORY_ITEMS`: `PLAY AGAIN`, `MENU` |
| `game-over` | `GAME_OVER_SAVE_ITEMS`: `CONTINUE FROM SAVE`, `MENU` in Standard while a save exists; otherwise `GAME_OVER_ITEMS`: `PLAY AGAIN`, `MENU` |

`specs/controls.md` states the keyboard, pointer, and touch input that moves the
highlight over these items and confirms one, and the hit region each item
occupies.

`mode-select` shows each mode's death rule before it is chosen, and `size-select`
shows each size's Core depth in meters before it is chosen.

`how-to-play` covers the goal of building and launching the rocket, the controls,
the dig-sell-upgrade loop, that the drill cuts down, left, and right but never up,
fuel and the climb home, the cargo's slots and its weight, the hazards, the
materials and the scanner, saving, and the two modes.

## Transitions

Every move between screens is one of these. Confirming an item means the
`activate` action on the highlighted item, or a pointer or touch confirm on that
item, which `specs/controls.md` states.

| From | Input | To |
| --- | --- | --- |
| `title` | `CONTINUE` | `in-mine`, resuming the save |
| `title` | `NEW EXPEDITION` | `mode-select` |
| `title` | `HOW TO PLAY` | `how-to-play` |
| `mode-select` | `STANDARD` or `HARDCORE` | `size-select`, with the expedition's mode set to the one chosen |
| `mode-select` | `BACK`, or the `pause` action | `title` |
| `size-select` | `QUICK`, `STANDARD`, or `MARATHON` | `in-mine`, beginning the expedition at that size in the mode chosen at `mode-select` |
| `size-select` | `BACK`, or the `pause` action | `mode-select` |
| `how-to-play` | `BACK`, or the `pause` action | `title` |
| `in-mine` | The `pause` action, with no panel open | `paused` |
| `paused` | `RESUME`, or the `pause` action | `in-mine`, carrying on where the freeze stopped |
| `paused` | `RESTART` | `in-mine`, on a fresh expedition in the same mode and size |
| `paused` | `QUIT TO MENU` | `title` |
| `victory` | `PLAY AGAIN` | `in-mine`, on a fresh expedition in the same mode and size |
| `victory` | `MENU` | `title` |
| `game-over` | `CONTINUE FROM SAVE` | `in-mine`, restoring the save |
| `game-over` | `PLAY AGAIN` | `in-mine`, on a fresh expedition in the same mode and size |
| `game-over` | `MENU` | `title` |
| `in-mine` | The rocket launches | `victory` |
| `in-mine` | A death | `game-over` |

The `pause` action is raised by `Escape` and by `KeyP` alike, so either key opens
the pause menu from `in-mine` and either resumes the expedition from `paused`.
With a panel open, `pause` closes that panel and leaves the screen on `in-mine`,
as `specs/controls.md` states.

## Returning to a menu

Arriving at a menu by going back selects the entry that led away from it.

| Arriving at | From | Selected |
| --- | --- | --- |
| `title` | `how-to-play` | `HOW TO PLAY` |
| `title` | `mode-select`, by `BACK` or `pause` | `NEW EXPEDITION` |
| `title` | `paused` by `QUIT TO MENU`, or `victory` or `game-over` by `MENU` | `NEW EXPEDITION` |
| `mode-select` | `size-select`, by `BACK` or `pause` | the entry of the mode the expedition is set to, `STANDARD` or `HARDCORE` |

The entries are named rather than numbered, because `CONTINUE` is present on
`title` only while a save exists and shifts the ones below it when it is.

Every other arrival at a menu highlights that menu's first item, so `menuIndex`
is `0` on `mode-select` reached from `title`, on `size-select`, on
`how-to-play`, on `paused`, on `victory`, and on `game-over`.

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
| `inventory` | The contents `specs/mining.md` states for the inventory overlay, each ore row with its drop control and each held field supply with a `USE` control, plus `JETTISON` while a Core Sample is carried. |

`inventory` opens anywhere; the other five open only at their buildings. Every
panel and menu is fully operable with the pointer and with touch as well as with
the keyboard, as `specs/controls.md` states.

## The status bar

The status bar occupies `y` in `[0, HUD_H]` and is always fully visible while
`in-mine`. It shows:

- the fuel gauge, taking the alert treatment below `LOW_FUEL_FRACTION`;
- the hull gauge, taking the alert treatment below `LOW_HULL_FRACTION`;
- the cargo, as slots used over capacity with the load in kilograms alongside,
  taking the alert treatment while the bay is full and reading `OVERLOAD` while
  the miner is overloaded;
- the Credits;
- the depth in meters;
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
- Gamepad input, and a touch control layout for driving the miner. The miner is
  driven from the keyboard; the pointer and touch drive the menus, the panels,
  and the status bar.
- Combat and enemies of any kind.
- Selling fuel or hull back for Credits.
- Any ore, material, hazard, building, or upgrade track beyond those specified.
