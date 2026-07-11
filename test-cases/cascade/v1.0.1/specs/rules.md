# Rules

## Overview

This file defines how a game is dealt and every legal move. It builds on the pile
layout in `specs/layout.md` and the coordinate system in `specs/overview.md`. How
many cards the stock turns at once is defined in `specs/deal-mode.md`, and this
file refers to it as the **turn count**.

## The Deck and the Deal

- A single standard 52-card deck: four suits (♠ ♥ ♦ ♣), thirteen ranks each
  (Ace, 2–10, Jack, Queen, King). Ace is low (rank 1); King is high (rank 13).
- Shuffle the full deck uniformly at random at the start of every new game.
  The shuffle must be genuinely random from game to game (seed it from a
  non-deterministic source), so no two deals are alike and the deal is not
  predictable.
- Deal into the seven tableau columns, left to right: column `n` receives `n`
  cards (column 1 gets 1, column 2 gets 2, …, column 7 gets 7), for 28 cards in
  all. In each column every card is dealt face-down **except the last**, which is
  turned **face-up**. So after the deal each column shows one face-up card on top
  of `n − 1` face-down cards.
- The remaining 24 cards form the **stock**, face-down, in dealing order. The
  **waste** and all four **foundations** start empty.

A fresh, correct deal is the first thing a viewer checks, so it must be exact:
seven columns of `1..7` cards, one face-up card atop each, 24 in the stock, waste
and foundations empty.

## Foundations

- The four foundations each build **one suit upward from Ace to King**: only an
  Ace may start an empty foundation, and thereafter only the next-higher card of
  the **same suit** may be added (2 on Ace, 3 on 2, …, King on Queen).
- Any suit may be started on any empty foundation; a suit is not tied to a fixed
  slot. Once a foundation holds an Ace, it accepts only that suit.
- Cards on the foundations are normally left there. (A build may allow pulling a
  foundation card back to the tableau, but this is optional and never required.)

## Tableau

- A tableau column builds **downward in rank and alternating in color**: a card
  may be placed on a face-up card whose rank is exactly **one higher** and whose
  color is the **opposite** (red on black or black on red). For example a black
  6 may go on a red 7.
- Only a **King** (or a run headed by a King) may be moved onto an **empty**
  column.
- **Moving a run.** A contiguous run of face-up cards that is already in
  descending-alternating order may be moved together as a unit onto a legal
  target (a tableau card one higher and opposite in color, or an empty column if
  the run is headed by a King). You pick up the run from the card you grab down
  to the bottom of the column; every card below the grabbed card moves with it.
- **Turning a column card.** When a move leaves a column's new bottom card
  **face-down**, that card is immediately turned **face-up**. A face-down card is
  never playable until it is exposed and turned this way.
- Face-down cards may not be moved, reordered, or peeked at.

## Stock and Waste

- Clicking the **stock** turns the **turn count** of cards face-up onto the
  **waste** (see `specs/deal-mode.md`). If fewer than that many remain, it turns
  all that remain.
- Only the **top card of the waste** is playable — onto a foundation or a tableau
  column by the rules above. Playing it exposes the card beneath.
- When the stock is **empty**, clicking its (empty) slot **recycles** the entire
  waste back into the stock, face-down, preserving order, so it can be turned
  again. There is **no limit** on the number of passes through the stock.

## Legal Moves

A held card or run may be dropped only onto a pile that accepts it:

- **onto a foundation** — a single card that is the next card up for that
  foundation (an Ace onto an empty foundation, or the next-higher card of the
  matching suit). A run may not be dropped onto a foundation; foundations take one
  card at a time.
- **onto a tableau column** — a single card, or a valid run, whose top card is
  one lower and opposite in color to the column's current bottom card; or, onto
  an **empty** column, any card or run headed by a King.

A drop that does not satisfy these rules is **rejected**: the card or run returns
to where it was picked up, and nothing changes. The game must never allow an
illegal placement.

## Auto-move to Foundation

**Double-clicking** a playable card (the top of the waste, or the bottom face-up
card of a tableau column) sends it directly to the foundation it belongs on, if
that move is currently legal; otherwise the double-click does nothing. This is a
convenience for the common "send this card home" move and must obey exactly the
same foundation rules as a manual drop.

## Winning

The game is **won** when all 52 cards are on the foundations (each foundation
complete from Ace to King). On the win, play stops and the **victory cascade**
begins — see `specs/cascade.md`. There is no separate loss state: a game with no
legal moves left is simply unwinnable, and the player starts a new deal from the
menu or the New Game control (see `specs/flow.md`).
