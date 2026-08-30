# Cascade — The foundations

This file defines the four foundations and what each of them accepts. The columns
are in `specs/tableau.md`, the waste in `specs/stock.md`, and the gestures that
carry a card to a foundation in `specs/controls.md`.

## What a foundation accepts

A foundation builds one suit upward from Ace to King. It accepts a card by these
rules, and refuses every other card offered to it.

| The foundation holds | It accepts |
| --- | --- |
| Nothing | An Ace, of any suit |
| Cards, its top card being rank `r` of suit `s` | The card of rank `r + 1` and suit `s` |
| Its King | Nothing |

A foundation takes exactly one card at a time. A run of two or more cards is
refused, even when its leading card alone would be accepted.

A foundation accepts a card from a tableau column and from the waste, on exactly
the terms above.

## Suits and slots

Any suit may be started on any empty foundation, so the suits are not tied to
fixed slots. Once a foundation holds a card it is locked to that card's suit, and
a card of any other suit is refused for as long as the foundation holds cards.

A foundation is complete when it holds thirteen cards, its Ace through its King.

## The foundation a card belongs on

A card belongs on the foundation that would accept it: the one already holding
the next-lower card of its own suit, or, for an Ace, an empty foundation. Every
card belongs on at most one foundation, since no two foundations hold the same
suit. `specs/controls.md` states the gesture that sends a card to the foundation
it belongs on.

## Leaving a foundation

A foundation's top card may be moved back onto a tableau column that accepts it
by the rules in `specs/tableau.md`. The card leaves the foundation, and the card
beneath it becomes that foundation's top card.
