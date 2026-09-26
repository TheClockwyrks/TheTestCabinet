## Overview

**Orrery** is a machine-building puzzle for the browser, played on a dark hex
field under a celestial fiction. A challenge names reagents and products:
constellations of motes, from bare stardust and the four essences up the
planetary ladder from Saturn to Sol. The player engraves sigils on the field,
stands brass arms over them, writes each arm a looping tape of instructions,
and sets the machine turning. Rises deliver reagents, arms grab and swing whole
constellations, sigils bind, wane, mirror, ascend, conjoin, eclipse, and
disperse whatever rests on them, and sets consume the finished constellations
until every product has been delivered six times.

A machine is scored three ways at once, on cost, cycles, and area, and the game
keeps a per-challenge record of the best of each, so one challenge has cheap
answers, fast answers, and compact answers. The other pressure is physical.
Every arm moves simultaneously, carried motes sweep real arcs across the field,
and two motes coming too close at any of the cycle's sample points halts the
machine on the spot with the collision marked.

There are two ways to play, both in every build. Extras is a fixed shelf of ten
challenges the specification pins exactly, from carrying a single mote to bonded
chains consumed by a repeating set. Campaign is the course the build designs
itself: eight to sixteen challenges of its own invention, in rising difficulty,
collectively exercising every sigil and mechanism in the game, and each shipped
with a working reference solution. A build has to solve its own puzzles and the
specification's alike.

The model also makes the game's own art and sound, during the build, with the
asset-generation tools on the run image's `PATH`. Fifteen mote sprites, the
filaments, the twelve engraved sigils, the ten instruction glyphs and the part
pieces are drawn; the rises and sets open and close as real aperture sheets; the
delivery, completion and fault effects are produced particle systems played
through the particle runtime; and six cues and a seamlessly looping music bed are
produced too, then wired into the game. The finished repository ships a showcase
of its own beside its source: a description of the game and a short carousel of
media the build captures from itself playing.

## Why it is a benchmark

Orrery is a simulation case first. The cycle is a fixed pipeline: fetch, drops,
grabs, a simultaneous motion sweep, then an ordered sigil phase, sets, rises,
and the completion check. Motion is rigid-body over hexes, with a multi-hold
consistency rule deciding when two arms may share a constellation and when they
tear it. Collision is a sampled sweep of eight fractions per cycle against a
fixed radius, pinned by eleven worked examples with computed distances, so a
rotation through a tight gap faults while a straight slide through the same gap
clears. The sigils are a pipeline of their own, four waves in reading order,
each reading the field as the last left it.

The second half of the case is a direct-manipulation editor of real size: a
tray measured in fixed slots, drags with legality ghosts, track laid hex by hex,
a tape panel with a cursor, fixed scroll rules, two macros computed from
an arm's own pose history, and session-wide undo. The whole surface is driveable
through the debug API's pointer operations and real key events, and whole
machines load and read back as JSON. Validators can therefore smoke-test the
editing gestures on fixed challenges and then step loaded machines cycle by
cycle through every sigil, fault, and metric. The campaign requirement closes
the loop: a build must design puzzles and then prove them solvable with
solutions its own debug surface hands over.

On top of that correctness sits a full production pass, and the two are graded
apart. A machine that runs perfectly under code-drawn placeholders and a handsome
sky over a sweep that mishandles its collision samples both fall short; the run
is rated on Campaign, Extras, the workshop the game is operated through, and the
presentation the case hands entirely to the build, and its overall rating is the
worst of the four.

The look is left open. Orrery fixes the geometry, the rosters, and legibility,
so fifteen mote types read at a glance, triune filaments read heavier than
plain, and an arm's grip is visible. It fixes no palette, no font, and no
artwork, and every build's sky is its own.

## What a model is given

A run receives the self-contained specification and a configured TypeScript
project to build inside: the Vite, Vitest, ESLint, and Prettier toolchain, and
the page with its canvas. How much more it receives depends on the engine the
run selects. On an engine run the project also carries the runtime and the
case-owned modules that name every figure the specification fixes and stand the
engine up, and the run writes the game and its debug surface against them. On an
engineless run the project carries no source at all, and the run writes the
runtime as well as the game. Pointer handling belongs to the build under every
engine.

Orrery ships no pre-made assets and declares no reference mockups. The run image
puts the 2D asset-generation tools on the model's `PATH`, and the model produces
the motes, the filaments, the sigil engravings, the instruction glyphs, the part
pieces, the rise and set aperture sheets, three particle systems and the game's
sound with them before wiring the committed files into the build. The
specification fixes the geometry, the rules, the ten Extras challenges, and the
campaign's obligations exactly; the palette, the type, and the look of the sky
are the build's.

Every point on the checklist is decided by a validator: `1054` review items
across `16` categories worth `1056` points, each one observable behavior posed
through the game's own instrumentation surface and read back, and each with a
suite in the validator project of every engine the item covers. The reviewer's
judgement goes into the per-domain ratings of visuals, polish and feel.
