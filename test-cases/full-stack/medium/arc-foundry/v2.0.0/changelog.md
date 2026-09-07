## Arc Foundry runs on any of three engines

A run of this case now chooses the runtime the produced game is built on, the way
it already chose a model and a harness. The seeded starter project is one per
engine rather than one for the case: `engines` names the engineless run,
`[[engine]]` pins [Simple 2D](/engines/simple-2d/) and
[Structured 2D](/engines/structured-2d/) at `>= 1.0.0` with no ceiling, and a
`[workspaces]` table names a directory for each of the three.

The foundry they build is the same foundry. What differs is how much of it the
model writes. Under `none` the project is the toolchain and an `index.html` and
nothing else: the build writes the frame loop and its delta time, the canvas fit,
keyboard and pointer input, audio, asset loading, the diagnostics overlay, the
`window.__foundry` surface, and the game. Under either engine the runtime is
vendored in as a package and the project seeds the modules around the game,
`src/constants.ts` and `src/main.ts`, leaving the build `src/game.ts` — the state,
the game itself, and the debug surface its `initialize` returns.

Neither engine supplies pathfinding, collision response, or a random source,
so the maze router that walks the ordered waypoint chain, the never-seal
test, the projectile flight, and the scrap-press roll are the build's own work
under all three. What an engine takes off the build is the layer beneath the
foundry, not the foundry.

Because the three projects deliver one game, the review items, the domains, and
the validators that decide them are the same across engines, and a score recorded
under one is comparable with a score recorded under another. The specs branch on
`engine.slug` only where the deliverable genuinely differs.

## The produced code is type-checked, linted, formatted and tested

A `[toolchain]` table declares four commands run over the produced tree once it is
installed: `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .`, and
`npx vitest run --coverage`. `typecheck` gates — a build that does not compile is
not reviewable — and the other three are recorded and gate nothing, with `test`
also recording the count and coverage the build's own suite reports. All three
seeded projects ship the configuration each command reads.

## Every review point is decided by a validator

Every point on the checklist names a validator, and each point states the highest
rating its domains may reach while it fails. Nothing on the list is left to a
reviewer's unaided judgement, including the produced art, the electrical VFX and
the audio: each of those is decided by reading something objective off the running
build rather than by looking at a picture of it. A reviewer rates the run's
aesthetics and may override a verdict.

The checklist is far finer than the one it replaces: 287 points across 24
categories, where a point that could once fail for either of two reasons is now
two points, and the edge cases the rules already imply — a weaker slow landing on
a stronger one, a chain with nothing left to leap to, a placement that would
strand a unit already on the yard — are points of their own. A third scoring
domain joins them: `audio` rates the twelve produced cues on their own, beside
`simulation` for how the foundry plays and `presentation` for the produced art and
the interface that presents it.

The validators are per engine rather than per variant. `validation/none/` drives
the built site in headless Chromium through `window.__foundry`; `validation/simple-2d/`
and `validation/structured-2d/` run in process against the vendored engine and
reach the surface through `engine.debug`. All three run the same scenarios and
differ only in how they stand a build up.

The `tick_hz` key is gone, and with it the fixed 60 Hz tick the simulation used to
run on. Every rate the specification states is now per second and integrated against
the delta time the frame loop hands each update, so an interval of simulation time
reaches the same state however it was divided into frames, and each validator builds
whatever clock its scenario wants.

## Appearance is the build's; behavior is exact

This version declares no `[[reference]]` views, no `[[proof]]` artifacts and no
`[[check]]` comparisons, and seeds no `specs/proof.md`. No picture of the finished
game is handed to the model, and none is asked back from the build: every piece of
evidence a reviewer sees is captured by a validator from the build's own drawing.
In exchange, every behavior a validator reads is stated exactly in the specs, and
what the specs fix about the look is what must be visible rather than how it is
drawn.

The finished build ships a **showcase** of its own instead: `specs/showcase.md` is a
new spec asking for a store-page presentation beside the source, a player-facing
description and a short ordered carousel of captured media, and the prompt points the
model at it.

## A unit's maximum HP is a whole number

`specs/enemies.md` derived a unit's HP on wave `w` from `baseHP × baseMult ×
[ (1 + k × (w − 1)) + c × (r^(w − 1) − 1) ]` and left the result a real number.
Every figure it produced was fractional — a Wave-1 Medium Filament came out at
`74 × 0.22 = 16.28` — so two builds that both implemented the formula correctly
could report different HP for the same unit depending on whether, and how, they
rounded it. Nothing in the specs said which was right.

The formula now rounds: `HP(w) = round( baseHP × baseMult × [ … ] )`, to the
nearest whole number with an exact half rounding up, and the spec states that a
unit's maximum HP is an integer. One derivation is spelled out in both rounding
directions — a Medium Mote's `9.68` is `10` HP, a Filament's `16.28` is `16`.
The rule is scoped to maximum HP; damage in flight, including a burn's per-tick
loss, is unchanged. Every place the formula appears rounds with it.

The underlying balance is untouched: no roster value, difficulty constant, or wave
count moved, and the figures a build now reports are the ones the reference
implementation already produced.

## Medium's HP-scaling constants agree across the specs

One spec restated Medium's surcharge constants as `c = 0.18` and `r = 1.13`,
against the `c = 0.28` and `r = 1.145` the difficulty table gave. A build reading
both could not satisfy them at once. The difficulty table is right, the two
outlying values are gone, and the constants are now stated in exactly one place.

## Tags

`gemtd` leaves `tags`, which now read `tower-defense`, `strategy`, `2d`.
