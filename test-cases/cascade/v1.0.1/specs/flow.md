# Flow

## Overview

This file defines the game's states and screens, the controls, the on-table HUD,
and what is out of scope. It refers to the layout in `specs/layout.md`, the rules
in `specs/rules.md`, the win animation in `specs/cascade.md`, and the turn count
defined in `specs/deal-mode.md`.

## Game states

The game is a small state machine. Each state has a clear screen and controls.

1. **Title / main menu.** Shows the title `CASCADE`, a short tagline (for example
   `KLONDIKE SOLITAIRE`), and a vertical menu listing **`NEW GAME`**, **`HOW TO
   PLAY`**, and, next to or beneath the title, a small label naming the
   deal mode (see `specs/deal-mode.md`). The felt table may show
   dimmed behind the menu. The selected item is highlighted in the accent color.
2. **How to play.** A simple screen describing the goal (build the four
   foundations Ace-to-King by suit), the mouse controls below, and the deal mode.
   Returns to the menu.
3. **In game.** The live table: stock, waste, four foundations, and the seven
   tableau columns, played entirely with the mouse. The HUD (below) sits clear of
   the piles.
4. **Won.** Entered the instant the last card reaches the foundations. The
   **victory cascade** plays (see `specs/cascade.md`) over the table, then a brief
   `YOU WIN` message with a prompt to start a new game. Dismissing it (a click or
   the New Game control) clears the cascade and deals a fresh game.

There is no pause state and no timed loss; solitaire is untimed here (see
`specs/overview.md` — this build keeps **no score and no clock**).

## Controls

Cascade is **mouse-driven**; everything needed to play is doable with the mouse
alone.

### Mouse (primary)

- **Turn the stock** — click the stock pile to turn the mode's turn count of
  cards onto the waste; click the empty stock slot to recycle the waste (see
  `specs/rules.md`).
- **Move a card or run** — press on a playable card and **drag** it. Grabbing a
  face-up tableau card picks up that card and every face-up card below it as a run
  (`specs/rules.md`); grabbing the waste's top card picks up that one card.
  Release over a target pile to drop. While dragging, the held card(s) follow the
  cursor and float above the table; a legal drop target under the cursor is
  highlighted in the drop-target color. Releasing over a legal target completes
  the move; releasing anywhere else **returns** the card(s) to their origin.
- **Auto-move to foundation** — **double-click** a playable card (the waste's top
  card, or the bottom face-up card of a column) to send it to its foundation when
  legal (`specs/rules.md`).
- **HUD controls** — click the on-table controls (below).
- **Menus** — click an item to select and activate it.

A face-down card is never draggable, and a face-down tableau card that becomes the
column's bottom card is turned face-up automatically (`specs/rules.md`).

## HUD

The HUD is deliberately minimal (there is no score or clock):

- A small **`NEW GAME`** control, and a small **`MENU`** control, placed clear of
  the piles (for example along the bottom edge of the table). `NEW GAME` deals a
  fresh game immediately; `MENU` returns to the title.
- A small, dim **mode label** (for example `DRAW THREE`) so the deal mode
  is always visible during play. Its text comes from `specs/deal-mode.md`.
- If you implement undo, an **`UNDO`** control may sit alongside these.

## Key Behaviors

The game must exhibit these behaviors:

- The deal is exactly as `specs/rules.md` states: seven columns of `1..7` cards,
  one face-up per column, 24 in the stock, waste and foundations empty, reshuffled
  every new game.
- Foundations build up by suit from Ace to King; tableau columns build down in
  rank and alternate in color; only a King (or a King-headed run) moves to an
  empty column.
- A valid multi-card run moves as a unit; an illegal drop is rejected and the
  cards return to their origin.
- Exposing a face-down column card turns it face-up.
- The stock turns the mode's turn count to the waste and recycles with no pass
  limit; only the waste's top card is playable.
- Double-clicking a playable card sends it to its foundation when legal.
- Completing all four foundations wins the game and triggers the cascade.

## Out of scope

- Other solitaire games — FreeCell, Spider, Pyramid, and the like are not part of
  this case. Build only the Klondike solitaire this specification describes.
- Scoring, timers, statistics, or a move counter — this build tracks none of them.
- Hints, an auto-solver, or an auto-complete button that finishes the game for the
  player.
- Persistence of games or settings between sessions.
- Network, online, or multiplayer play; touch or gamepad input (mouse only for
  this version).
