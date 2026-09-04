## Wireworm is a TypeScript project, on one of three engines

This version stops asking a model for a self-contained page built on top of a
bare `package.json` and asks it for a real project instead. A run is seeded with
a complete TypeScript workspace, with Vite, `tsc`, ESLint, Prettier and Vitest
already configured, an `index.html` holding the canvas, and the sprite art under
`assets/`. How much of that project the model writes is what the engine decides.

Under [Simple 2D](/engines/simple-2d/) and [Structured
2D](/engines/structured-2d/) the workspace also carries the case-owned modules
around the game, `src/constants.ts` and `src/main.ts`, and the model writes
`src/game.ts` against them. Everything the specification fixes as a number, a key
binding, a cue name or a piece of screen copy has a name in `src/constants.ts`,
and the specs cite those names rather than restating the figures. The engine owns
the frame loop, the canvas fit, keyboard input as named actions, audio as named
cues, asset loading and the debug overlay; Structured 2D also owns rendering and
the framework the game is written inside, so the game there is a game definition,
a mode, actors, components and a controller. What stays the build's is Wireworm
itself: the board, the charged field, the discharge, the worm, the foes and
everything drawn.

Under `none` the workspace is that toolchain and nothing else: ten files at the
root, and no `src/` at all. The model writes every line of what runs, from the
frame loop and its delta time up to the game.

## Three engines, one game

Because all three projects deliver the same game, the review items, the domains
and the checks that decide them are the same across engines, and a score recorded
under one engine is comparable with a score recorded under another. The specs
branch only where the deliverable differs, on `engine.slug` and never on the
variant, and the three validator suites differ only in how they stand a build up.
The one `base` variant ships a reference implementation per engine, under
`references/<engine>/`, and the case's Reference tab offers a switch between
them.

## No mandated fixed timestep, and the worm's cadence is a formula

`v1.0.0` declared `tick_hz = 120`, so the case asked for a game clocked at a rate
the harness fixed. `v2.0.0` declares none. Every rate in the specification is per
second and integrated against the delta time the frame hands the game, and each
validator constructs its own clock and asks for exactly the frames it wants.

The one clocked quantity left is the worm's tile step, and it is now stated as a
closed form rather than as an approximation. `v1.0.0` asked for `0.14 s` at level
one, "about 7 tiles per second", shortened "by about 5%" per level with a floor
of "~`0.07 s`", which no check can hold a build to at level 12. The rule is now
`wormStepInterval(level) = max(WORM_STEP_FLOOR, WORM_STEP_L1 * WORM_STEP_DECAY^(level - 1))`,
with the three names beside it and two worked values, and the step is a per-worm
accumulator over the frame's delta time with a stated catch-up rule.

## The produced code is type-checked, linted, formatted and tested

A `[toolchain]` table declares four commands run over the produced tree once it is
installed: `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .`, and
`npx vitest run --coverage`. They run against the code the model wrote, and their
results are carried on the run. `specs/overview.md` names the same four, so the
build knows what it is held to.

## Every review point is decided by a validator

The checklist grew from `77` points to `227` items, and every one of them names a
Vitest suite under `validation/<engine>/`, the domains its failure lowers, and
how far it lowers them. The `74` standalone browser scripts of `v1.0.0` are gone.
Under `none` a suite drives the built site in headless Chromium through
`window.__wireworm`, taking the game off real time with `setAutoStep(false)` and
stepping it with `advance`; under either engine the same scenario runs in process
against the vendored engine, standing it up over a canvas and a clock of its own
and reaching the surface through `engine.debug`.

Nothing is left to a reviewer to decide from a screenshot. The reference
mockups, the `[[proof]]` captures and `specs/proof.md` are gone with the scripts:
every piece of media a reviewer looks at is now produced by the case's own
validators, from scenarios the case controls, and the same suites run against
each engine's reference build to produce the baseline the run's media is shown
beside.

## Four domains instead of two

`v1.0.0` rated a run on `charge` and `arcade`, so the worm and the whole
fixed-shooter frame around it shared one number. A run is now rated on `charge`,
`worm`, `arcade` and `presentation` independently, and its overall rating is the
worst of the four, so a build whose discharge is exact and whose worm does not
split is told apart from one where it is the other way round.

## The debug surface poses one field at a time

The `v1.0.0` surface could not pose a scenario. `setWorm({ segments, dh, dv })`
and `spawnFoe(kind, options)` took a patch, so the case imposed its own layout on
the build rather than setting a field. `startRun()`, `enterPlay()` and
`setLevel(n)` each arranged several things at once, so what a scenario had
actually posed was never one thing. `fire()` named an outcome rather than a
precondition. `clearField()` emptied the nodes and nothing else, with no
`clearWorms`, `clearFoes` or `clearBolts` beside it, so no check could pose a
world holding only what it was about. And worms and foes carried no `id`, so an
entity could only be addressed by its position in a roster that the game itself
reorders.

Every operation is now atomic, takes scalars, and is verifiable by set-then-read:
each one sets one field, reads the state, or moves the clock, and `snapshot()`
reports every field an operation can set. A worm is built a segment at a time
with `addWorm(c, r)` and `appendSegment(id, c, r)`; its headings, its dive and its
two faculties are set one call each. A foe is added with `addFoe(kind, x, y)` and
steered with `setFoeVelocity`. `clearField` becomes `clearNodes`, so its name says
which of the four rosters it empties, and `clearWorms`, `clearFoes` and
`clearBolts` join it. `fire()` is gone: a check that wants a bolt places one with
`addBolt(x, y)`, and a check about firing holds the fire action and reads the
bolts that appear. Every worm, foe and bolt carries an `id`, an entity added
through the surface is appended to its roster, and a worm cut in two keeps its id
on the piece holding the old head.

There is deliberately no `setMuted`. Mute is reached the way a player reaches it,
through the `KeyM` binding, and `muted` is a live read of the runtime's own mute
bit at the call rather than a shadow field a pose could write.

## Every scenario poses a world holding only what it is about

Emptying the rosters is not enough on its own, because three faculties belong to
the level rather than to any entity in it and walk into a scenario that never
asked for them: the level's own foe spawning, the level's and the respawn's entry
of a worm, and the cursor's contact test. A check posed on an empty board is
maximally sparse, so from level 3 a dropper is drawn in on the first `2.5 s`
check and from level 2 a glitch arrives every `7`–`12 s`; and the cursor is the
one entity a scenario cannot remove, so a worm oscillating at the floor or a foe
descending far enough would cost a life and empty both rosters mid-check.

Each of those is now a gate of its own — `setFoeSpawning`, `setWormEntry` and
`setCursorContact` — each gating one faculty and nothing else, defaulting to on,
restored to on by `reset`, and reported by `snapshot()` so it is verifiable by
set-then-read. Entities carry the same treatment per faculty:
`setWormStepping`/`setWormBody` hold a worm's step apart from its body's follow,
and `setFoeMind`/`setFoeTravel` hold a foe's behavior apart from its locomotion,
so a check on what a glitch eats poses it stationary and a check on how it
travels poses it moving, and neither can be disturbed by the other. Nothing is
contained instead of removed: a bystander is deleted rather than parked in a
quiet corner, because parking it leans on the very rules a broken build breaks.

## The specifications were rewritten

Every spec was rewritten against the current authoring guidelines, and the file
set changed with them. `specs/charge.md` splits into `specs/nodes.md`, which owns
the field and its charge, and `specs/discharge.md`, which owns detonation and the
chain arc. `specs/cursor.md`, `specs/scoring.md`, `specs/state.md` and
`specs/showcase.md` are new; `specs/proof.md` is gone. `specs/board.md` takes sole
ownership of the tile-to-stage map, and `specs/cursor.md` sole ownership of the
contact rule and the half-extents that decide it, so each rule lives in exactly
one file.

The prose states what the finished build must be and do and nothing about how to
build it. Behavior a check reads is stated exactly or between explicit bounds,
and two rules the earlier specs left to each build to invent are now written
down: when a level's worm enters, and what happens when a blocked worm drops into
an occupied tile.

Appearance moved the other way. `v1.0.0` seeded a canonical palette of twenty-odd
hex values, a monospace requirement, and fixed HUD copy. None of that is in
`v2.0.0`. The specs state what a player must read at a glance — the four charge
states as a ramp, the worm apart from the board and from a node, its head, body
and tail told apart, the cursor apart from its band, the three foes apart from
one another, a bolt apart from the column it climbs, the band as a floor, and
legible text — and the palette, the type, the glow and every other aspect of the
look are the build's. The presentation validators assert that a thing is drawn and that two
things are told apart, against a stated RGB distance, never a hex value.

## The cursor's speed is stated, and measured where the band cannot truncate it

`specs/controls.md` fixed no cursor speed. It asked only that movement be
"responsive enough to dodge a diving worm and a skittering glitch", which is not a
property a build can be held to, so how fast the cursor crossed the band was left
to each build to guess at — while the band-clamp check quietly required a number
of its own. Its horizontal probes swept the full `1248` units of the band inside a
fixed window, so reaching the bound at all demanded about `312` units per second.
The point claimed to measure the clamp and was in fact measuring the rate, and a
build whose cursor moved more slowly failed a clamp it honored exactly.

`specs/cursor.md` now fixes the rate at `CURSOR_SPEED` (`430`) units per second,
the same in every direction, and the two points that read it are sized to the band
they run in. **`cursor.move-speed`** holds the cursor for exactly one second from
mid-band, left and right, and asserts `430` units within 5%. It uses two
horizontal probes only: the band is `32` units tall, crossed in `0.074 s`, so a
vertical hold would report the clamp rather than the rate. Vertical movement is
`controls.up-arrow` and `controls.down-arrow`, which assert direction.
**`cursor.diagonal-speed`** holds right and up together for a second and asserts
the horizontal displacement is `CURSOR_SPEED / sqrt(2)` (`304`) within 5%, which
is exactly what separates a normalized diagonal from an unnormalized one and
survives the vertical clamp that a total-path figure of `430` would not.

The four clamp points measure the clamp and nothing else.
`cursor.clamped-left` and `cursor.clamped-right` pose the cursor `120` units
inside the bound they test, so no horizontal clamp point asks for a rate by
accident. `cursor.clamped-top` and `cursor.clamped-bottom` pose it on the
opposite bound and hold for a second, thirteen times the crossing time. The
`120`-unit inset is deliberately not applied to the vertical pair: the band
cannot hold it, `setCursor` applies the real clamp, so a pose `120` units inside
a vertical bound would silently land on the other bound and the point would
describe a scenario that never happened.

## A drop passes through whatever is in the tile below

`specs/worm.md` blocked the worm's horizontal step on a node, a segment or the
side edge, and said nothing about the tile a blocked worm then drops into. On a
board that thickens every time you shoot the worm — which is the whole of this
case's field-growth engine — dropping onto an occupied tile is ordinary rather
than rare, and every build had to invent an answer: pass through it, turn a
second time, stall in the row, or charge what it landed on.

The rule is now written where it was missing. Only a horizontal step can be
blocked. A drop enters the tile one row down, or up, in the head's own column
whatever stands there, and leaves it exactly as it was, neither charged nor
destroyed nor able to turn the worm. That is what the dive already did, so the
two now read alike.

Four points hold the rule and its consequences, each asserting one of them.
**`worm.drop-passes-through-node`** and **`worm.drop-passes-through-segment`**
assert that the head ends the step on the occupied tile and keeps its vertical
heading. **`nodes.drop-leaves-charge`** asserts that the node under it is
untouched. **`nodes.shared-tile-keeps-charge`** asserts that a bolt into a
segment standing on a node leaves that node's charge alone; the shortening is
`worm.shot-tail-shortens`'s requirement, so a build that fails the shortening is
not docked twice for one defect. All of them pose the node at charge `2`, never
`0` and never `3`, because `2` is the only value from which "charged", "cleared",
"replaced by a fresh inert node" and "detonated" all read as different numbers.

## The glitch is posed on the board rather than hunted for on it

A glitch that never reaches the visible board can weave and descend perfectly
while producing a recording of an empty board. The old `glitch-zigzag` point
failed such a build, correctly, but described the failure as "the glitch enters
the board" and then reported that it did not dart or descend either — three bare
booleans a reviewer watching an empty recording could not tell apart from a
glitch that was never spawned at all. The point claimed to measure the zig-zag
and was in fact measuring whether the build's own spawner had put a foe anywhere
a check could see.

`addFoe("glitch", x, y)` places a foe's center at a stated position on the board,
so the spawner is no longer in the reading and a glitch can never be held outside
the board. The one boolean becomes two points that report distances.
**`foes.glitch-descends`** reports how far the center traveled down against the
`GLITCH_V_SPEED` (`62`) the spec fixes, within 20%. **`foes.glitch-darts`**
asserts the rule `specs/foes.md` now states outright — at each
`GLITCH_DART_INTERVAL` (`0.32 s`) the glitch reverses its horizontal direction —
by counting nine sign reversals of the reported `vx` over three seconds and
reporting the distance swept each way, so a failure names a number. Stating the
rule rather than leaving the re-pick to chance is the point: a check that assumed
a random re-pick would fail a spec-honoring build on an unlucky seed, which is
the flake this fix exists to remove rather than to move. **`instrumentation.entity-ids`**
carries the other half of it: a foe is read by its `id` and its `kind`, never by
its position in the roster.
