## Cascade is a TypeScript project, on one of three engines

This version stops asking a model for a self-contained page built on top of a
bare `package.json` and asks it for a real project instead. A run is seeded with
a complete TypeScript workspace, with Vite, `tsc`, ESLint, Prettier and Vitest
already configured and an `index.html` holding the canvas. How much of that
project the model writes is what the engine decides.

Under [Simple 2D](/engines/simple-2d/) and [Structured
2D](/engines/structured-2d/) the workspace also carries the case-owned modules
around the game, `src/constants.ts` and `src/main.ts`, and the model writes
`src/game.ts` against them. Every figure the specification fixes — the table's
anchors, the card footprint, the overlaps and the compression floor, the control
rectangles, the double-click window, the cascade's launch cadence and its
gravity, the screen copy — has a name in `src/constants.ts`, and the specs cite
those names rather than restating the numbers. The engine owns the frame loop,
the canvas fit, pointer input, audio as named cues and the debug overlay;
Structured 2D also owns rendering and the framework the game is written inside.
What stays the build's is Cascade itself: the deal, the rules, the pointer play,
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

`v2.0.0` said what a stock turn puts on the waste and what the waste fans, but
not what the waste is showing once the turned cards have been played off. Draw
Three reaches that state — turn, turn and play one home, turn and play all three
home, and the waste owes two cards — and nothing in the old wording decided it, so
a build could show one card (a counter that only remembers the last turn) or
three (a fan of `min(3, waste)`) and contradict nothing.

`specs/stock.md` now states the rule positively: the waste keeps each turn's
cards together as a set, remembers the sets in the order they were turned, shows
the cards still on the newest set that holds any, and falls back to what is left
of the set turned before it once a set is played off entirely. Recycling clears
the waste and its sets with it.

In `v3.0.0` that memory is no longer a note beside a counter. `wasteSets` is a
declared field of the state, posed one set at a time by `addWasteSet(count)`,
reported by `snapshot()`, and `wasteVisibleCount` is derived from it rather than
stored. It is reported under both variants, so one validator suite reads both.

## No mandated fixed timestep

`v2.0.0` declared `tick_hz = 120`, so the case asked for a game clocked at a rate
the harness fixed. `v3.0.0` declares none. Every rate in the specification is per
second and integrated against the delta time the frame hands the game, and each
validator constructs its own clock and asks for exactly the frames it wants.

## A debug surface of atomic operations

The whole debug and automation surface is redesigned, and no operation survives
with its `v2.x` signature. `setBoard(state)` is gone: a board is built one card
at a time with `addCard(pile, index, suit, rank, faceUp)` over a table emptied by
`clearTable()` or a pile emptied by `clearPile(pile, index)`, so a validator poses
the pile its requirement concerns and nothing else. Every card and every flyer
carries a stable `id`, and every per-entity operation takes one. `move` and
`autoMove` take scalars and return what the game's own rules decided. Four
faculties that intruded on posed scenarios — the automatic flip, win detection,
the cascade's launching and the trail's painting — each became their own gate,
default on, restored by `reset` and reported by `snapshot()`.

## The produced code is type-checked, linted, formatted and tested

A `[toolchain]` table declares four commands run over the produced tree once it
is installed: `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .`, and
`npx vitest run --coverage`. They run against the code the model wrote, and their
results are carried on the run. `specs/overview.md` names the same four, so the
build knows what it is held to.

## Every review point is decided by a validator

The checklist is 226 common items across fourteen categories, plus six on Draw
One and ten on Draw Three, and every one of them carries a validation script and
a `failure_cap`. Each is one observable behaviour, so a build fails exactly the
rule it breaks. The legacy flat `validation/` tree of browser drivers is replaced
by three Vitest suites, one per engine, under `validation/<engine>/`.

## No palette, no typeface, no reference mockups

`v2.x` wrote a canonical thirteen-colour palette and a system-font requirement
into the specification and seeded reference screenshots a build was compared
against. `v3.0.0` fixes none of it. What the specification states about the look
is a legibility table — what a player must be able to read at a glance — and
everything else is the build's own design. `reference/`, `reference-impl/` and
`specs/proof.md` are gone, and the build ships a `showcase/` of its own captured
media instead.
