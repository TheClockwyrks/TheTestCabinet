## The cursor's speed is specified, and checked on its own

`specs/controls.md` fixed no cursor speed. It asked only that movement be
"responsive enough to dodge a diving worm and a skittering glitch", which is not a
property a build can be held to, so how fast the cursor crossed the band was left
to each build to guess at — while the band-clamp check quietly required a number
of its own. Its horizontal probes swept the full 1248 px of the band inside a
fixed window, so reaching the bound at all demanded about 312 px/s, and a build
whose cursor moved more slowly failed a clamp it honoured exactly.

The speed is now stated: a held movement key slides the cursor at `430 px/s`, the
same rate in every direction, with a diagonal hold no faster than a straight one.
The new Cursor & Firing point **`move-speed`** measures it directly, over an exact
one-second window in each direction, run in the middle of the band where the clamp
cannot truncate the travel being measured. `clamped-band` no longer measures it by
accident: each of its four probes now starts 120 px inside the bound it tests
(`setCursor` places the cursor anywhere in the band, so a probe can be posed beside
its bound rather than walked there), which asks 120 px/s of a build and leaves the
speed requirement to the point that names it. The clip is shorter for it, and still
shows the cursor sliding into all four bounds in turn.

## A drop passes through whatever is in the tile below

`specs/worm.md` blocked the worm's horizontal step on a node, a segment, or the
side edge, and said nothing about the tile a blocked worm then drops into. On a
board that thickens every time you shoot the worm — which is the whole of this
case's field-growth engine — dropping onto an occupied tile is ordinary, not rare,
and every build had to invent an answer: pass through it, turn a second time, stall
in the row, or charge what it landed on.

The rule is now written where it was missing. Only a horizontal step can be
blocked; a drop enters the tile one row down (or up) in the head's own column
whatever stands there, and leaves it exactly as it was, neither charged nor
destroyed nor able to turn the worm. That is what the dive already did with
"ignoring nodes and walls", so the two now read alike.

Two consequences the drop makes common are written down with it: a bolt fired into
a column where a segment stands on a node strikes the segment, and the fresh inert
node a shot-killed segment leaves is not laid where a node already stands, so the
node under it keeps its charge. `specs/charge.md` says the same about the collision
it describes, naming the head being blocked by the tile ahead rather than any
contact between a segment and a node.

Both new rules are checked. The Data-Worm gains **`drop-passes-through`** (a worm
turned into a charged node below it lands on the tile, keeps descending, and leaves
that node's charge alone) and **`shot-on-shared-tile`** (a bolt into a tail resting
on a `C = 2` node shortens the worm and leaves the node at `2`). Both pose the node
charged rather than inert, so every wrong answer reads as a different number.

## The zig-zag point says when the glitch is off the board

A glitch that never reaches the visible board can weave and descend perfectly while
producing a clip of an empty board. The old `glitch-zigzag` point failed such a
build, correctly, but described the failure as "the glitch enters the board" and
then reported that it did not dart or descend either — three bare booleans that a
reviewer watching an empty recording could not tell apart from a glitch that was
never spawned at all.

The point now separates the cases and reports distances rather than booleans: that
`spawnFoe` created a glitch, how far inside the nearest side edge it ever got, and
how far inside the board's top and bottom it ever got. A glitch held just outside
the edge reads as a negative number of pixels, which names what happened. The
motion window now samples wherever the glitch actually is, so a build that skitters
correctly outside the board is told that, rather than being reported as motionless.
The foe is also read by kind rather than by position in the foe list.
