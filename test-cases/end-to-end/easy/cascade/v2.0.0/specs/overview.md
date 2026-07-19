# Cascade

## Overview

Cascade is a single-player solitaire card game for the browser, a Klondike
patience played on a green felt table. Twenty-eight cards are dealt into seven
tableau columns, and the player builds the four foundations up from Ace to King,
one suit each, by moving cards between the columns, turning cards from the stock,
and freeing buried cards. Clear all fifty-two to the foundations and the game is
won, at which point every foundation card launches off the table in a bouncing,
screen-painting victory cascade that gives the game its name.

Cascade is played entirely with the mouse: click the stock to turn cards, drag a
card (or an ordered run of cards) onto a legal pile, and double-click a card to
send it straight to its foundation. The craft of the build is a responsive,
legible table and a win animation with real weight.

Cascade is its own game, with an original name, table, card design, and palette.
Klondike is a public-domain set of rules, but do not reproduce the assets,
branding, card art, or exact look of any existing solitaire product. Draw the
cards and the table yourself from this specification.

## How the specification is organized

This specification is split across several files:

- `specs/overview.md` — this file: the overview, goal, hard requirements, free
  choices, coordinate system, and visual design.
- `specs/table.md` — the table layout: the stock, waste, foundations, and the
  seven tableau columns, with positions, card size, and overlap.
- `specs/rules.md` — the deal and the rules of play: how cards move, what moves
  are legal, how the foundations and tableau build, and how the game is won.
- `specs/states.md` — the game states and screens, the mouse controls, the HUD,
  and what is out of scope.
- `specs/victory.md` — the victory cascade animation, defined with exact motion
  values.
- `specs/deal-mode.md` — the deal mode: how many cards the stock turns at a time
  and its menu label.
- `specs/instrumentation.md` — the debug and automation API and the read-only
  debug overlay the build exposes.

Read every spec file and implement the game they describe as a single, cohesive
build. The specs cross-reference each other by name; treat them as one
specification.

## Goal of this build

Produce a complete, polished, playable game of Klondike solitaire that runs
entirely in a browser. This is a real front-end task: a full deck model,
legal-move validation, drag-and-drop between piles, an auto-move to the
foundations, win detection, a physics-driven win animation, and the menus and
state transitions that tie a title screen, live play, and the win screen
together. Aim for a build a person would actually enjoy playing, not a tech demo.

### Hard requirements

- Renders real graphics. Draw the table and the cards with Canvas 2D,
  WebGL/WebGPU, or positioned DOM elements. A text-only or ASCII rendering does
  not satisfy this requirement. Every card is drawn in code; there are no image
  assets to load.
- Runs in the browser with no backend. No server, accounts, database, or network
  calls at runtime. Everything needed to play must be self-contained.
- No API keys or credentials of any kind to build, run, or play.
- npm-driven static build. The project must be a Node project with a
  `package.json` at its root, buildable with only Node.js and npm-installed
  dependencies (no separately installed language toolchain). Commit a
  `package-lock.json`: the build is installed with `npm ci`, which requires that
  lockfile. Running `npm ci` and then `npm run build` must produce the complete
  static site, with no further manual step, into one of `dist/`, `build/`, or
  `out/` at the project root, with an `index.html` at the root of that directory
  as the entry point. That output directory must run correctly when served as-is
  at the root of any static file server, since it is deployed to static hosting
  exactly that way. You choose the language, framework, bundler, and rendering
  approach behind this interface; only the `npm ci` and `npm run build` commands
  and where the build output lands are fixed.
- Debug and automation surface. Expose the `window.__cascade` debugging and
  automation API and the read-only debug overlay described in
  `specs/instrumentation.md`, on the same footing as the game itself.
- Documentation. Include a `README.md` in the produced repository explaining what
  the game is, how to install dependencies, how to run it in development, how to
  produce the static production build, and the controls.

### Free choices

You choose the language, framework, bundler, and rendering approach, subject to
the requirements above. Plain TypeScript with Canvas 2D is entirely sufficient; a
framework is not required. Favor a clean, well-structured codebase, with a clear
model of the deck, the piles, and the legal moves, over any particular
technology.

## Coordinate system and presentation

All positions, sizes, and speeds in this document are given in logical pixels on
a fixed 1280 x 720 table (16:9). The origin `(0, 0)` is the top-left; `x`
increases to the right and `y` increases downward.

- The table scales uniformly to fit the browser window while preserving its 16:9
  aspect ratio, letterboxed with the surrounding color on the remaining space.
  The game must remain correct and centered at any window size.
- Game logic (pile positions, hit-testing, the win animation) operates in
  logical-pixel space, independent of the rendered scale.
- The whole table must be on screen. At every window size the complete 1280 x 720
  area is visible at once: the stock, the waste, all four foundations, every
  tableau column including a long column at its full extent, and any HUD control,
  fitted to the window and centered, with nothing clipped or pushed past the
  edges. The build must fit correctly on load, before any input, and at any pixel
  density.

## Visual design

The look is a warm deck of cards on a green felt table. The canonical palette and
type are defined below; match them.

| Element                       | Color     |
| ----------------------------- | --------- |
| Table felt                    | `#1a7a4a` |
| Felt shade (edge vignette)    | `#12603a` |
| Empty pile slot outline       | `#0e5233` |
| Card face                     | `#f7f4ec` |
| Card face border              | `#cfc9b8` |
| Red suit (hearts, diamonds)   | `#c62828` |
| Black suit (spades, clubs)    | `#1b2733` |
| Card back field               | `#2a5db0` |
| Card back motif               | `#9ec1f5` |
| Drop-target highlight         | `#ffd54a` |
| Primary text (on felt)        | `#f4f9f5` |
| Secondary / dim text          | `#bfe0cd` |
| Accent (menu selection)       | `#ffd54a` |

- Use a system sans-serif type family for all text (menus, labels, the card
  ranks). Do not depend on a web font that must be downloaded; a system stack is
  required so the game renders identically offline. Suits are drawn with the
  standard Unicode pips `♠ ♥ ♦ ♣`, which the system font supplies.
- Cards. A face-up card is a rounded rectangle (`100 x 140`, corner radius `8`)
  in the card-face color with a thin border, showing its rank and a small suit
  pip in the top-left corner (and mirrored, rotated 180°, in the bottom-right),
  plus one large suit pip centered on the face. Red suits use the red color,
  black suits the black. A face-down card is the same rectangle filled with the
  card-back field color and an original repeating motif in the back-motif color (a
  lattice, diamond grid, or similar of your own design). Cards carry a soft drop
  shadow so a lifted or dragged card reads as floating above the table.
- Empty slots. A pile with no cards shows its slot as a rounded rectangle outline
  in the slot-outline color. The four foundation slots each show a large, dim suit
  pip (`♠ ♥ ♦ ♣`) as a hint; the stock slot shows a circular recycle glyph when it
  is empty but the waste still holds cards.
- The three canonical screens, the title screen, the in-game table, and the win
  screen with its cascade, are described in full under Game states in
  `specs/states.md` and, for the animation, in `specs/victory.md`. Implement each
  as described, in this palette and type.

## Reference images

The `reference/` folder holds screenshots showing how key screens should look:

- `reference/title.png` — the title screen and main menu.
- `reference/gameplay.png` — a representative in-game table mid-play.
- `reference/victory.png` — the win screen with the cascade under way.

Treat them as illustrative examples, not targets to reproduce: they show one way
the screens can look, but design your own menus and layout rather than copy them.
The only firm requirement is that every menu and navigation path this
specification mandates is present, rendered in the palette and type the spec
defines. They are images only; build the screens from this specification.
