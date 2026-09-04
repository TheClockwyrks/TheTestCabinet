## Overview

**Facet** is a gem-matching puzzle for the browser, played over a lapidary's lit
bench with a mouse, a pen, or a finger. Eight columns by eight rows of cut stones
fill the board. A player takes hold of a stone, carries it onto the one beside
it, and lets go; three or more of a kind in a line clear, the stones above fall
into the gap, and fresh ones drop in from the top, so one move can touch off a
chain that runs long after the player's hand has left the board. Carrying a
stone back where it came from before letting go takes the move back.

What makes Facet its own game is **strain**. Every clear stresses the stones left
standing around it, and that stress never lets go: a stone carries its cracks for
the rest of the round and takes them with it when it falls. A stone cracked
through is **flawed**, and a flawed stone goes whenever anything beside it goes.
Ordinary play therefore primes the board a little at a time, and a swap dropped
into a well-primed corner tears a hole clean through it. Strain cannot be
relieved, only spent, so the board is always either a resource being built up or
one about to be cashed in.

Three cuts sit on top of that. A line of four leaves a **brilliant** that takes
its neighbors with it, a line crossing another leaves a **star** that takes its
whole row and column, and a line of five or more leaves a **prism** that takes every
stone of whatever kind it is traded against.

A round has no clock. A meter fills as stones clear, each level asking more
than the last and totting up its longest chain and its best single move before
the next board pours in from above, and the round ends when the board has no
legal move left on it.

## Why it is a benchmark

Facet reads as one of the most familiar puzzles there is, and that is the point:
the shape of the game is common knowledge, so what separates one build from
another is whether the rules underneath it are exactly right. A chain step has to
seed a clear set from the runs on the board, grow it to a fixed point through the
cuts and the flawed stones, score it, spread strain to the survivors, collapse
the columns, and refill — in one order, with one answer, every time. Around that
sit a seeded deal that owes the player an opening board with a legal swap on it,
a legal-swap search that decides when the round is over, a move that is offered
and withdrawn under the hand before a release commits it, animation the rules
have to wait on rather than paper over, and six screens every one of which a
player with nothing but a touchscreen has to be able to work — built three times
over, once with no engine beneath it and once on each of the two 2D engines.

It is also a full asset build. Every stone on the bench is a produced file rather
than a shape drawn in code: the model draws all seven kinds in each of their four
cracked states, the animation each one plays as it breaks, the bursts that come
off a clear, the aura that never stops running on a cut stone, the ascending run
of tones a chain climbs, and the music underneath, using the production tools on
the run image. That places it at the easy end of the full-stack scale — a small,
tightly specified game whose difficulty is precision rather than scale, carrying
a full production pass over its own art and audio.
