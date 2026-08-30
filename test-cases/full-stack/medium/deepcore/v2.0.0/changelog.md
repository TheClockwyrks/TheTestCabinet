## Deepcore is a TypeScript project, on any of three engines

This version stops handing a run a bare repository and hands it a real project
instead. A run is seeded with a complete TypeScript workspace, with Vite, `tsc`,
ESLint, Prettier and Vitest already configured and an `index.html` holding the
canvas. How much of that project the model writes is what the engine decides,
and the engine is chosen per run alongside the model and the harness.

Under `none` the workspace is that toolchain and nothing else. There is no
`src/`: the build writes the frame loop and its delta time, the canvas fit, the keyboard
input, the audio, the diagnostics overlay, the transform that scrolls the mine
past the camera, the `window.__deepcore` surface, and every figure the
specification fixes, and then the game on top of all of it.

Under [Simple 2D](/engines/simple-2d/) the workspace also carries the case-owned
modules around the game, `src/constants.ts` and `src/main.ts`, and the model
writes `src/game.ts` against them. That engine owns the frame loop, the canvas
fit, input as named actions, audio as named cues and the overlay, but it owns
neither rendering nor a camera, so the build still draws the mine itself and
still applies its own scroll transform to the 2D context it is handed.

Under [Structured 2D](/engines/structured-2d/) the same two modules are seeded
and the model writes its game module: the game definition, its mode, its live
state, its actors, and the debug surface its instance's `initialize` returns.
That engine owns rendering and a camera, so the descent down a shaft scrolls
through the engine's own camera rather than through a transform the game
applies.

The mine is the same game under all three, so a score recorded under one engine
is comparable with a score recorded under another. The specification branches
only where the deliverable genuinely differs.

## The produced code is type-checked, linted, formatted and tested

A `[toolchain]` table declares four commands run over the produced tree once it
is installed: `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .`, and
`npx vitest run --coverage`. They run against the code the model wrote, against
configuration the case fixed, and their results are carried on the run. The
typecheck gates: a build that does not compile is not reviewable, and is rated
broken.

## Every review point is decided by a validator

The checklist no longer leaves a point to a reviewer's unaided judgment. Every
graded point carries a suite, the domains its failure lowers, and a failure cap
saying how far that failure can pull the rating down, so a grade says which
requirement failed and how much it cost. The points that used to be left to a
person, the feel of the produced miner animation and the look of the mine among
them, either gained a validator that decides something objective about the
produced asset or stopped being a scored point and became part of the run-wide
aesthetic rating.

## The mockups, the proofs and the similarity checks are gone

Nothing pictorial is seeded as a target to match, no build is asked to
screenshot itself into a `proof/` directory, and no screen is scored against a
baseline image. Every piece of evidence a reviewer sees is captured by a
validator from the build itself, side by side with the same capture from the
reference. `specs/proof.md` went with them.

## The finished game ships a showcase

A build now writes a short player-facing description of the game it made and a
small ordered carousel of captured media beside its source, the way a store page
presents a game. The case carries the same thing for itself, captured from the
reference build.
