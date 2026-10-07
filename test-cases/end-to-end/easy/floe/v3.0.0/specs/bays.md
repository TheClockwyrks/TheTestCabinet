# Floe — The bays and the bonus catch

This file fixes what the five far-shore bays are, what filling one does, and the
bonus catch that visits them. Where the bays sit is in `specs/strait.md`.

## Open and filled

A level opens with all `BAY_COUNT` (`5`) bays open. A bay is open until a crossing
ends in it, and filled from then until the level is over.

- The two columns of an open bay are the only tiles of the far shore a hop may
  land on, and `specs/hopping.md` fixes the refusals that follow from that.
- A filled bay is occupied. The critter that filled it rests there for the level.

## Filling a bay

A crossing ends on the hop that lands the critter in an open bay, which is a hop
up from row `2`. On that hop:

- that bay becomes filled, and no other bay changes;
- the crossing is scored, as `specs/scoring.md` fixes;
- every bear on the strait is removed, as `specs/hunter.md` fixes;
- the critter leaves the strait.

When open bays remain, a fresh crossing then begins from the near shore after the
hold `specs/progression.md` fixes. A bay filled this way stays filled through
every later crossing of the level, and through a death.

## Clearing a level

A level is cleared by the hop that fills its last open bay. The clear follows
from that hop and from no other event, so a strait whose bays stand filled
without such a hop is a level still being played.

`specs/progression.md` fixes what a cleared level leads to.

## The bonus catch

A bonus catch is a small fish that visits the open bays. At most one is on the
strait at a time, and it is worth `SCORE_BONUS_CATCH` to a crossing that ends in
its bay, as `specs/scoring.md` fixes.

| Rule                                                                                                | Figure                  |
| --------------------------------------------------------------------------------------------------- | ----------------------- |
| A level opens with no bonus catch out, and the first appears this long after the level is laid out. | `FISH_INTERVAL` (`8` s) |
| A bonus catch lingers in its bay this long, then leaves.                                            | `FISH_LINGER` (`5` s)   |
| The next appears this long after the previous one leaves.                                           | `FISH_INTERVAL` (`8` s) |

The bay a bonus catch appears in is drawn at random when it appears, uniformly
among the bays that are open at that moment other than the bay the previous
bonus catch occupied. Where no such bay exists, none appears and the next arrives
`FISH_INTERVAL` later.

A bonus catch leaves when it has lingered `FISH_LINGER`, or the moment its bay is
filled, whichever comes first. It changes nothing about whether its bay may be
entered.
