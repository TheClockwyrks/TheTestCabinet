## Cascade is a TypeScript project, on one of three engines

This version stops asking a model for a self-contained page built on top of a
bare `package.json` and asks it for a real project instead. A run is seeded with a
complete TypeScript workspace, with Vite, `tsc`, ESLint, Prettier and Vitest
already configured and an `index.html` holding the canvas. How much of that
project the model writes is what the engine decides.

Under [Simple 2D](/engines/simple-2d/) and [Structured
2D](/engines/structured-2d/) the workspace also carries the case-owned modules
around the game, `src/constants.ts` and `src/main.ts`, and the model writes
`src/game.ts` against them. Every figure the specification fixes — the table's
anchors, the card footprint, the overlaps and the compression floor, the drop
rectangles, the double-click window, the cascade's launch cadence and its
gravity, the screen copy — has a name in `src/constants.ts`, and the specs cite
those names rather than restating the numbers. The engine owns the frame loop, the
canvas fit, the pointer, audio as named cues and the debug overlay; Structured 2D
also owns rendering and the framework the game is written inside, so the game
there is a game definition, a mode, actors, components and a controller. What
stays the build's is Cascade itself: the deal, the rules, the pointer play,
everything drawn, and the victory cascade.

Under `none` the workspace is that toolchain and nothing else: ten files at the
root, and no `src/` at all. The model writes every line of what runs, from the
frame loop and its delta time up to the game.

## Three engines, one game

Because all three projects deliver the same game, the review items, the domains
and the checks that decide them are the same across engines, and a score recorded
under one engine is comparable with a score recorded under another. The specs
branch on `engine.slug` where the deliverable differs, and on `variant.slug` only
in the two files the deal mode reaches. Each variant ships a reference
implementation per engine, under `references/<engine>/<variant>/`, and the case's
Reference tab offers a switch between them.

## The waste remembers each turn as a set

`v2.0.0` said what a stock turn puts on the waste and what the waste fans, but not
what the waste is showing once the turned cards have been played off. Draw Three
reaches that state readily — turn, turn and play one home, turn and play all three
home, and the waste owes two cards — and nothing in the old wording decided it. A
build could show one card, remembering only the last turn, or three, refilling a
fan of `min(3, waste)` from the buried cards, and contradict no stated rule. The
check that read the fan claimed to measure what the waste shows and was in fact
measuring which of two undecided models the build had guessed at.

`specs/stock.md` now states the rule positively: the waste keeps each turn's cards
together as a set, remembers the sets in the order they were turned, shows the
cards still on the newest set that holds any, and falls back to what is left of
the set turned before it once a set is played off entirely. Recycling clears the
waste and its sets with it.

In `v3.0.0` that memory is no longer a note beside a counter. `wasteSets` is a
declared field of the state, posed one set at a time by `addWasteSet(count)`,
reported by `snapshot()`, and `wasteVisibleCount` is derived from it rather than
stored, so it is `0` exactly when the memory is empty. It is reported under both
variants, so one validator suite reads both. `draw-three.set-falls-back` is the
point that decides the rule, and it is driven through the build's own stock code
rather than a posed waste: two is the rule, one is the last-turn counter, three is
the refilled fan, and the waste still holds five cards underneath, so no wrong
model is clamped into the right answer by the size of the pile.

## Where a drop lands is a rule, not a reading

`v2.x` said a run is dropped by releasing it "over a target pile", which decides
nothing when a `100 x 140` card overlaps two of them. The point that claimed to
measure whether a build drops onto the pile the player aimed at was in fact
measuring whose overlap convention the build had invented.

`specs/table.md` now fixes every pile's drop rectangle as a figure, and
`specs/controls.md` states the one rule over them: the target is the pile whose
rectangle contains the centre of the run's leading card, a centre lying in exactly
one rectangle resolves to that pile, and a centre lying in none returns the run to
where it was lifted from. Both halves were needed. Without the rectangles a
column's target could be read as the card footprint at its anchor or as the
column's whole drawn extent, and both readings honour every other rule the specs
state.

## The drag threshold is a constant with a stated effect

`v2.x` seeded `DRAG_THRESHOLD` and never said what it decided, which is the shape
that produces flaky checks: every build honours a figure it was handed, and no two
builds honour it the same way. `specs/controls.md` now states both halves. A press
on a playable card puts the run in the hand on the press itself, so a run is held
from the press edge and `snapshot().drag` reports it before any motion; and a
release whose point lies within `DRAG_THRESHOLD` (`5`) of its press is a click
rather than a drop, returning any held run to where it was lifted from, activating
whatever control the press landed in, and pairing as the press-and-release the
double-click rule counts. `handling.drag-threshold` asserts it.

## A debug surface of atomic operations

The whole debug and automation surface is redesigned, and no operation survives
with its `v2.x` signature. `setBoard(state)` is gone: it was a partial patch
carrying the stock, the waste, the foundations and the tableau as nested arrays of
card objects, so it imposed the case's own state layout on the build and arranged
thirteen piles and the screen in a single call. A board is now built one card at a
time with `addCard(pile, index, suit, rank, faceUp)` over a table emptied by
`clearTable()` or a pile emptied by `clearPile(pile, index)`, so a scenario poses
the pile its requirement concerns and nothing else. `move` and `autoMove` took
structured locator objects and now take scalars, returning what the game's own
rules decided. `newGame()` and `selectMenu(index)`, each compound, are gone.

Every card and every flyer carries a stable `id`, so a validator can follow one
card across a move rather than addressing it by a position the game itself
reorders, and every per-entity operation takes one. Four faculties that intruded
on posed scenarios — the automatic flip, win detection, the cascade's launching
and the trail's painting — each became their own gate, defaulting to on, restored
by `reset` and reported by `snapshot()`. The rule the surface is built to is that
each operation sets one field, reads the state, or moves the clock, and that
`snapshot()` reports every field an operation can set, so every operation is
verifiable by set-then-read.

## No mandated fixed timestep

`v2.0.0` declared `tick_hz = 120`, so the case asked for a game clocked at a rate
the harness fixed. `v3.0.0` declares none. Every rate in the specification is per
second and integrated against the delta time the frame hands the game, and each
validator constructs its own clock and asks for exactly the frames it wants.

## The produced code is type-checked, linted, formatted and tested

A `[toolchain]` table declares four commands run over the produced tree once it is
installed: `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .`, and
`npx vitest run --coverage`. They run against the code the model wrote, and their
results are carried on the run. `specs/overview.md` names the same four, so the
build knows what it is held to.

## Every review point is decided by a validator

The checklist grew from `47` points across eleven categories to `226` across
fourteen, plus `6` on Draw One and `10` on Draw Three, and every one of them names
a Vitest suite under `validation/<engine>/`, the domains its failure lowers, and
how far it lowers them. Each asserts one observable behavior, so a build fails
exactly the rule it breaks. The `46` standalone browser scripts of `v2.0.0` are
gone. Under `none` a suite drives the built site in headless Chromium through
`window.__cascade`, taking the game off real time with `setAutoStep(false)` and
stepping it with `advance`; under either engine the same scenario runs in process
against the vendored engine, standing it up over a canvas and a clock of its own
and reaching the surface through `engine.debug`.

Nothing is left to a reviewer to decide from a screenshot. The reference mockups,
the `[[proof]]` captures and `specs/proof.md` are gone with the scripts: every
piece of media a reviewer looks at is now produced by the case's own validators,
from scenarios the case controls, and the same suites run against each engine's
reference build to produce the baseline the run's media is shown beside.

## Four domains instead of one

`v2.0.0` rated a run on `klondike` alone, so the rules, the pointer, the ending
and everything drawn shared one number. A run is now rated on `rules`, `handling`,
`cascade` and `presentation` independently, and its overall rating is the worst of
the four, so a build whose Klondike is exact and whose drag does not track is told
apart from one where it is the other way round.

## The specifications were rewritten

Every spec was rewritten against the current authoring guidelines, and the file
set changed with them. The seven files of `v2.x` become thirteen:
`specs/rules.md` splits into `specs/deal.md`, `specs/foundations.md`,
`specs/tableau.md` and `specs/stock.md`, one pile family each;
`specs/states.md` becomes `specs/screens.md`; `specs/controls.md`,
`specs/audio.md`, `specs/state.md` and `specs/showcase.md` are new; and
`specs/proof.md` is gone. `specs/table.md` takes sole ownership of every pile's
anchor, extent and drop rectangle, and `specs/controls.md` sole ownership of the
gestures that act on them, so each rule lives in exactly one file.

The prose states what the finished build must be and do and nothing about how to
build it. Behavior a check reads is stated exactly or between explicit bounds,
and the edge cases the old rules implied but never decided are now written down.

## No palette, no typeface, no reference mockups

`v2.x` seeded a canonical thirteen-color palette, a system-font requirement, and
reference screenshots a build was compared against. None of that is in `v3.0.0`.
The specification states what a player must read at a glance — a card's rank and
suit, red apart from black, a card back apart from a card face and from the table,
an empty pile as a slot, a held run as lifted, a highlighted target as
highlighted, and legible text — and the palette, the type, the card design and
every other aspect of the look are the build's. The presentation validators assert
that a thing is drawn where the specification says something is drawn, and never
what it was drawn in: how two things read against each other is the reviewer's.
`reference/`, `reference-impl/` and `specs/proof.md` are gone, and the build ships
a `showcase/` of its own captured media instead.
