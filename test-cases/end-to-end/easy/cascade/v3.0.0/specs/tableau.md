# Cascade — The tableau

This file defines the seven columns: what a column accepts, what a move takes out
of one, and when a card in a column turns face-up. Where the columns sit and how
they are fanned is in `specs/table.md`; the foundations are in
`specs/foundations.md`; the gestures that drive a move are in
`specs/controls.md`.

## A run

A run is one or more cards ordered so that each card is one rank lower than, and
the opposite color of, the card above it. A single card is a run of one. A run is
led by its highest card, which is the card that lands on the target.

## What a column accepts

A column accepts a run by these rules, and refuses every other run offered to it.

| The column's state | It accepts |
| --- | --- |
| Empty | A run led by a King |
| Its lowest card is face-up, of rank `r` and color `c` | A run led by a card of rank `r - 1` and the color other than `c` |
| Its lowest card is face-down | Nothing |

A run whose cards are not in run order is refused by every column and by every
foundation.

## What a move takes

A move out of a column takes one of its face-up cards and every card below it in
that column, in the order they lie there. The cards above the one taken stay in
the column, in their order and with their faces unchanged. A move whose taken
card is face-down is refused, and the board is left exactly as it was.

A run that moves lands on its target in the order it left, so the card that led
the run is the target's new lowest card and the rest follow beneath it.

A column accepts a run from another column, from the waste, and from a
foundation, on exactly the terms above.

## A refused move

A refused move changes nothing. Every card it carried returns to the pile it was
taken from, in the order it left, with every face as it was, and the target keeps
what it held. A column that was empty when a run was refused by it is still
empty.

## Turning an exposed card

When an accepted move leaves a column whose lowest card is face-down, that card
is turned face-up. Only that one card turns: every face-down card above it in the
column stays face-down. A move that leaves a face-up card lowest turns nothing,
and neither does a move that empties the column.

The turn belongs to the accepted move. Lifting cards off a column with the
pointer turns nothing while they are in hand, so a lift whose move is then
refused leaves the card beneath face-down throughout.

A face-down card is never moved and is never read. It becomes playable only once
it has been turned this way.
