## The waste remembers each turn as a set

The specs said what a stock turn puts on the waste and what the waste fans, but not
what the waste is showing once the turned cards have been played off. `rules.md` now
states the rule the whole behavior follows: the waste keeps each turn's cards
together as a set, remembers those sets in the order they were turned, and shows the
cards still on the newest set that holds any. Playing takes the top card of the shown
set, and a set that has been played off entirely falls back to what is left of the
set turned before it. Recycling clears the waste and its sets with it.

Draw Three is where this is visible: draw three, play one, draw three again, and
play all three, and the waste owes two cards, the pair the first turn was left with.
Nothing in the previous wording decided that, so a build could show one card (a
counter that only remembers the last turn) or three (a fan of `min(3, waste)`) and
contradict nothing. Draw One turns single-card sets, so the rule holds there without
changing what that deal shows.

Two supporting statements follow from it. `instrumentation.md` defines
`wasteVisibleCount` as the number of cards still on the shown set, and `0` on an
empty waste, in place of "up to the three the last stock turn brought over ... then
squares to one over the buried cards", which stated the counter reading as the rule.
It also pins what a posed board's waste means, since a `setBoard` waste has no turn
history of its own: it arrives as sets counted back from its top card, the deal
mode's turn count at a time. `table.md` describes the fan as the cards the waste is
showing rather than "the most recent few".

## A review item for the set the waste falls back to

`stock.waste-set-memory` is the new point, and it is the state the rule turns on: a
set played off entirely on top of a partly-played one. Its script turns the stock
three times and plays off the waste between the turns, so every set comes from the
build's own stock code rather than from a posed waste, then reads the fan and the top
card once the newest set is spent. The waste still holds five cards at that moment,
so neither wrong answer is clamped into the right one by the size of the pile: two is
the rule, one is the last-turn counter, three is the refilled fan.

Normal play reaches this state rarely, which is why it needed an item of its own.
Every other waste check agrees with all three models until a second set has been
played off over a first.

`stock.waste-fan-shrink` keeps its subject, the fan counting down within one set and
never refilling from the cards buried under it, and now states what the play that
spends that set falls back to, in the terms the rule gives.

## The reference implementations

Draw Three tracks the sets: `Game.wasteSets` holds how many cards are left on each
turn's set, oldest first, and the fan draws the newest entry that is not zero. A
cancelled waste drag returns its card to the set it was taken from, which is not
always the set showing once the card has left. Draw One needed no change, since a
turn of one is a set of one.
