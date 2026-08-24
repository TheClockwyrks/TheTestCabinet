## Overview

**Orrery** is a machine-building puzzle for the browser, played on a dark hex
field under a celestial fiction. A challenge names reagents and products:
constellations of motes, from bare stardust and the four essences up the
planetary ladder from Saturn to Sol. The player engraves sigils on the field,
stands brass arms over them, writes each arm a looping tape of instructions,
and sets the machine turning. Rises deliver reagents, arms grab and swing
whole constellations, sigils bind, wane, mirror, ascend, conjoin, eclipse,
and disperse whatever rests on them, and sets consume the finished
constellations until every product has been delivered six times.

Nothing about a solution is singular. A machine is scored three ways at once,
cost, cycles, and area, and the game keeps a per-challenge record of the best
of each, so a solved challenge is an invitation rather than an ending. The
other pressure is physical: every arm moves simultaneously, carried motes
sweep real arcs across the field, and two motes coming too close at any of
the cycle's sample points halts the machine on the spot with the collision
marked.

There are two ways to play, both in every build. **Extras** is a fixed shelf
of ten challenges the specification pins exactly, from carrying a single mote
to bonded chains consumed by a repeating set. **Campaign** is the course the
build designs itself: eight to sixteen challenges of its own invention, in
rising difficulty, collectively exercising every sigil and mechanism in the
game, and each shipped with a working reference solution, so the build has to
solve its own puzzles and the specification's alike.

## Why it is a benchmark

Orrery is a simulation case first. The cycle is a fixed pipeline: fetch,
drops, grabs, a simultaneous motion sweep, then an ordered sigil phase, sets,
rises, and the completion check, and every stage carries rules with teeth.
Motion is rigid-body over hexes, with a multi-hold consistency rule deciding
when two arms may share a constellation and when they tear it. Collision is a
sampled sweep, eight fractions per cycle against a fixed radius, pinned by
eleven worked examples with computed distances, so a rotation through a tight
gap faults while a straight slide through the same gap clears. The sigils are
a pipeline of their own, four waves in reading order, each reading the field
as the last left it. Getting any of this slightly wrong produces machines
that fault when they should run, or run when they should fault, and both are
visible.

The second half of the case is a direct-manipulation editor of real size: a
tray measured in fixed slots, drags with legality ghosts, track laid hex by
hex, a tape panel with a cursor, deterministic scroll rules, two macros
computed from an arm's own pose history, and session-wide undo. The whole
surface is driveable through the debug API's pointer operations and real key
events, and whole machines load and read back as JSON, so validators can
smoke-test the editing gestures on fixed challenges and then step loaded
machines cycle by cycle through every sigil, fault, and metric. The campaign
requirement closes the loop: a build must design puzzles and then prove them
solvable with solutions its own debug surface hands over.

The look is left open on purpose. Orrery fixes the geometry, the rosters,
and legibility, fifteen mote types readable at a glance, triune filaments
heavier than plain, an arm's grip visible, and fixes no palette, no font, and
no artwork, so every build's sky is its own and a reviewer judges the design
rather than the copying.

## What a model is given

A run receives the self-contained specification and a configured TypeScript
project to build inside: the Vite, Vitest, ESLint, and Prettier toolchain,
and the page with its canvas. How much more it receives depends on the engine
the run selects. On an engine run the project also carries the runtime and
the case-owned modules that name every figure the specification fixes and
stand the engine up, and the run writes the game and its debug surface
against them; on an engineless run the project carries no source at all, and
the run writes the runtime as well as the game. Pointer handling belongs to
the build under either engine. There are no assets and no reference mockups:
the specification fixes the geometry, the rules, the ten Extras challenges,
and the campaign's obligations exactly, and leaves the sky's appearance to
the build, drawn entirely in code.
