# Wireworm — The chain-arc discharge

A bolt into a critical node detonates it, and the detonation chains outward
through the charged cluster around it. This file defines the chain, what it does
to the worm, the arcs it reports, and how an arc is drawn. What a bolt does to a
node at every other charge is in `specs/nodes.md`.

## The chain

The whole chain resolves at the moment the bolt strikes, within the same update,
and the board it leaves behind is what the next update runs on.

1. The struck node detonates. A detonated node is removed from the board, and its
   tile is left empty.
2. A node that detonates arcs to every node at charge `1` or above that is
   standing at that moment and whose tile lies within `DISCHARGE_RADIUS` (`2`)
   tiles of the detonating node's tile, measured as a Chebyshev distance: the
   `5 x 5` block of tiles centered on the detonating node. Each of those nodes is
   itself detonated.
3. Each node the chain detonates arcs onward the same way, so the discharge floods
   through the connected cluster of charged nodes until no charged node stands
   within reach of any node it detonated.
4. A node is detonated at most once per discharge.

A node at charge `0` is neither detonated nor removed by a discharge, and it does
not conduct: the chain leaps over it, and a charged node reachable only through
an inert node is reached only if it lies within `DISCHARGE_RADIUS` of a node the
chain detonated by another route.

The chain runs outward from the struck node one wave at a time: every node the
struck node reaches detonates before any node those nodes reach, and so on. Within
one node's arcs, the nodes it reaches are taken in ascending row, then ascending
column.

## What the discharge does to the worm

Every worm segment whose tile lies within `DISCHARGE_RADIUS` (`2`) tiles of the
tile of any node the discharge detonated, measured the same Chebyshev way, is
destroyed. A segment further than that from every detonated node is untouched and
stays on its tile.

A segment destroyed by a discharge leaves nothing behind: no node is laid on the
tile it stood on. When a discharge removes segments from the middle of a worm, the
surviving runs become worms by the rule `specs/worm.md` states for a worm whose
segments are removed.

## The arcs

A discharge reports one arc for each link the chain conducted along: the ordered
pair of tiles joined by one node detonating another. A chain that detonates `n`
nodes therefore reports `n - 1` arcs, one for each node beyond the struck one,
naming the tile that detonated it and the tile it stands on.

Every arc of a discharge is created at the moment the chain resolves and lasts
`ARC_LIFE` (`0.32` s) of game time, after which it is gone. No arc is reported at
any other time.

## Drawing an arc

An arc is drawn as bright lightning joining the centers of the two tiles it
links, so a player reads which node set off which. Its shape is fixed when the
arc is created and holds unchanged for the arc's life, and any randomness in that
shape is drawn from the run's seeded random generator. The color and the form of
the lightning are yours.
