# Cascade — The deck and the deal

This file defines the deck the game is played with and the arrangement a new game
starts from. Where the piles sit is in `specs/table.md`, and what each of them
accepts once play begins is in `specs/foundations.md`, `specs/tableau.md`, and
`specs/stock.md`.

## The deck

One standard deck of `DECK_SIZE` (`52`) cards.

| Part | Values |
| --- | --- |
| Suits | `SUITS`, the four suits `spades`, `hearts`, `diamonds`, and `clubs` |
| Ranks | Whole numbers from `RANK_MIN` (`1`, the Ace) to `RANK_MAX` (`13`, the King) |
| Colors | Hearts and diamonds are red; spades and clubs are black |

Each of the fifty-two suit-and-rank pairs appears in the deck exactly once. Ace
is the low rank and King the high one, and a card's rank orders it against every
other card of its suit.

## The deal

Every new game deals from a full deck shuffled uniformly at random, so every
ordering of the fifty-two cards is as likely as any other and each new game is
dealt afresh.

The shuffled deck is dealt in this order:

1. `DEAL_TABLEAU_CARDS` (`28`) cards go to the `TABLEAU_COLUMNS` (`7`) columns,
   left to right: column `0` receives one card, column `1` two, and so on to
   column `6`, which receives seven.
2. In each column, every card is dealt face-down except the last one dealt, which
   is turned face-up. Each column therefore shows exactly one face-up card, and
   it is the column's lowest card on the table.
3. The remaining `DEAL_STOCK_CARDS` (`24`) cards form the stock, face-down, in
   the order they were left in after the tableau was dealt.
4. The waste starts empty, with no sets in its memory, and all
   `FOUNDATION_COUNT` (`4`) foundations start empty.

A new deal also clears the painted table, so a deal following a victory cascade
leaves clean felt behind it. `specs/victory.md` states what that layer is.
