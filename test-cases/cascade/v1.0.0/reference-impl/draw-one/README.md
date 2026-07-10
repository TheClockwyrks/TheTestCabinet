# Cascade — Draw One

**Cascade** is a green-felt **Klondike solitaire** for the browser. Twenty-eight
cards are dealt into seven tableau columns; you build the four foundations up from
Ace to King, one suit each, by moving cards between the columns, turning the stock,
and freeing the buried face-down cards. Clear all fifty-two home and you win — at
which point every foundation card launches off the table one after another and
**bounces**, arcing under gravity off the bottom edge and painting a permanent
trail across the screen: the **victory cascade** the game is named for.

This build is the **Draw One** deal mode — the gentler Klondike deal. Clicking the
stock turns exactly **one** card at a time onto the waste; that single card is the
playable top card, squared over any cards turned before it, so the waste needs no
fan. Recycling the empty stock is unlimited, so with one card per turn every stock
card is eventually reachable — the more winnable deal. Everything else — the deal,
the tableau and foundation rules, drag-and-drop, the double-click auto-move, win
detection, and the victory cascade — is identical to the base game; only the stock's
turn count and the single-card waste differ from **Draw Three**.

It is the authored **reference implementation** of the Draw One variant: the correct
build, shown on the case's Reference tab. It is never seeded into a run.

This is a self-contained static web app — plain **TypeScript** rendering to an
**HTML5 canvas**, bundled with **Vite**. Every card and the table are drawn in
code; there are no image assets. No backend, accounts, network calls, or API keys;
everything needed to play is in the built bundle.

## Controls

Cascade is **mouse-driven** — everything needed to play is doable with the mouse.

| Action | How |
| --- | --- |
| Turn the stock | Click the stock pile (turns one card to the waste) |
| Recycle the stock | Click the empty stock slot (returns the whole waste, unlimited) |
| Move a card or run | Press a playable card and **drag** it onto a legal pile |
| Send a card home | **Double-click** a playable card to auto-move it to its foundation |
| New game / Menu | Click the on-table **NEW GAME** / **MENU** controls |

Grabbing a face-up tableau card picks up that card and every face-up card below it
as a run; a legal drop target under the cursor is highlighted, and releasing over
an illegal spot returns the cards to where they started.

Optional keyboard accelerators: **N** new game, **Esc** return to the menu, and on
the title menu the **arrow keys** move the selection with **Enter** to activate it.

## The rules

- **Foundations** build up by suit from Ace to King: an empty foundation takes only
  an Ace, then only the next-higher card of the same suit.
- **Tableau** columns build down in rank and alternate in color (red on black or
  black on red). Only a **King** (or a King-headed run) may move onto an empty
  column.
- Exposing a face-down column card turns it **face-up**; face-down cards are never
  draggable.
- Completing all four foundations wins the game and triggers the cascade.

## Requirements

- Node.js 18+ and npm. No other toolchain is needed.

## Install

```sh
npm ci        # or: npm install
```

## Run in development

```sh
npm run dev
```

Vite serves the game with hot-reload at the URL it prints (default
`http://localhost:5173`).

## Production build

```sh
npm run build
```

This type-checks the sources (`tsc --noEmit`) and emits a complete static site into
**`dist/`**, with `index.html` at its root. Serve that directory as-is from any
static file server:

```sh
npm run preview        # serves dist/ locally for a final check
```

## Project layout

```
index.html            Vite entry; hosts the <canvas>
vite.config.ts        Build config (emits to dist/)
src/
  main.ts             Bootstrap: canvas fit/letterbox + render loop
  constants.ts        Palette, geometry, layout, cascade physics (logical 1280x720)
  types.ts            Shared types (Card, suits, screens)
  deck.ts             Deck construction + a CSPRNG-seeded shuffle
  layout.ts           Pile rects, column positions + long-column compression, HUD
  game.ts             State machine, rules engine, drag-and-drop, auto-move
  cascade.ts          The victory-cascade simulation (fixed timestep, bouncing)
  cards.ts            Card / slot / highlight drawing
  render.ts           All canvas drawing (title, table, how-to-play, win)
  input.ts            Mouse + optional keyboard, mapped to logical coordinates
```
