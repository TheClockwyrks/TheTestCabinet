# Orrery — the validator projects

Three vitest projects, one per engine, holding the checks that decide Orrery's
1053 review items. `test-case.toml` points every validated item at a script path
like `sigils/bind-joins-two-motes.test.ts`, and the runner resolves that path
inside **every** engine's project — so one review item is **three files at the
same relative path**, and the case does not resolve until all three exist. The
twelve items that narrow their `validation` with `engines = ["none"]` are the
exception: a scoped item's suite ships in `none/` alone, and the case does not
resolve while a copy of it is left in a project the item does not cover.

```
validation/
  none/            driven out of process, in Chromium, over window.__orrery
  simple-2d/       driven in process, over the engine, state held BY VALUE
  structured-2d/   driven in process, over the engine, the world is LIVE
```

## The one rule everything here exists to serve

**A suite deciding one review item is the same text in all three projects.**

What differs between the three is the harness, never the reasoning. So the three
`harness.ts` files expose the same member names, the same argument shapes and the
same return shapes, and everything else in a project is _byte-identical_ across
the three:

| Identical in all three                                                                         | Different per engine                                      |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `constants.ts`, `field.ts`, `parts.ts`, `formats.ts`, `challenges.ts`, `fixtures.ts`           | `harness.ts`                                              |
| `driver.ts`, `snapshot.ts`, `scenario.ts`, `drawing.ts`, `color.ts`, `viewport.ts`, `media.ts` | `surface.ts`                                              |
| `assets/*.ts`, `tsconfig.json`                                                                 | `vitest.config.ts`                                        |
|                                                                                                | `assert.ts`                                               |
|                                                                                                | `none/` also: `globalSetup.ts`, `setup.ts`, `chromium.ts` |

`assert.ts` is the one entry in the right-hand column that is not a difference in
reasoning. The assertions are the shared validator harness's vocabulary, and the
engineless project re-exports it (`export * from "./case-harness/assert"`) because
`@clockwyrks/case-harness` is staged only into an engineless project; the two
engine projects write the same 26 names out, byte-identical to each other. A suite
says `from "../assert"` in all three and gets the same names, the same signatures
and the same message shape, which is what the rule above is actually about.

If you change a shared file, change it in all three. Nothing in the case compares
the three copies, and nothing drives a `harness.ts` through its whole surface, so
a member that drifts under one engine is caught only where some suite happens to
use it. A change to one project's harness that makes a suite need editing under
that engine alone has broken the rule, quietly — read the other two before
landing it.

**Every member of the harness answers a promise**, even where an in-process call
has nothing to wait for. A suite that awaited under one engine and did not under
another would be two suites.

## What a suite imports

Five specifiers, and they resolve to the same names in all three projects:

```ts
import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert"; // the verdict's shape
import { HEX_PITCH, SPEEDS } from "../constants"; // every figure specs/ fixes
import { at, hexCenter, targetHex } from "../field"; // the hex and stage oracle
import { machineCost, sigilHexes } from "../parts"; // the anatomy oracle
import { BARE, ORIGIN, WEST } from "../fixtures"; // the posed worlds
import { createHarness, openBareRun, spawnMote } from "../harness";
```

`../harness` re-exports `scenario.ts`, `drawing.ts`, `color.ts`, `viewport.ts`,
`snapshot.ts` and `media.ts`, so everything a check drives, reads or writes
arrives through it.

## The vocabulary

Everything below is one call, under the same name, on all three engines.

**Standing up** — `createHarness(options?)`, `h.dispose()`.
`options` carries `frameMs`, `cssWidth`, `cssHeight`, and `dpr`.

**The clock** — `h.advance(frames)` runs frames at the harness's own rate;
`h.advanceSeconds(seconds, frames)` runs a span of game time divided into whole
frames, which is the primitive the two cycle helpers are built on;
`advanceCycles(h, n)` and `advanceFraction(h, f)` name cycles and fractions of one
at whatever speed the run is set to; `h.until(pred, opts)` and
`h.stepWatching(n, watch)` sweep. Every one of them is frames a check asked for,
so no check waits on the wall clock and a span costs the frames it is divided
into rather than the seconds it names.

**Reading** — `h.snapshot()`, plus the readings in `snapshot.ts`
(`partById`, `moteAt`, `poseOf`, `gripsOf`, `heldBy`, `constellationOf`,
`tallyOf`, `progressOf`, …). `partIds(h)` answers the ids of the parts on the
field **in placement order**, which is what a check that posed its machine as a
DOCUMENT needs: `placePart` and its siblings answer the one id they placed, and a
machine loaded through `openBareRun`'s `machine` places several at once. It is
also the order `sim.fault.parts` is reported in.

**Posing an isolated world** — `openBareRun(h, { challenge })` is the opener
almost every check uses: reset, load the challenge, clear the machine, hold the
completion switch off, start the run, empty the field. `openRun` is the same with
completion left on, for the checks that are about it. `clearWorld(h)` empties the
world between two scenarios. Then place back exactly what the requirement is
about: `placePart`, `placeRise`, `placeSet`, `placeTrack`, `spawnMote`,
`spawnConstellation`, `writeTape` — each answers the new part's or mote's id.

**The faculty gates** (`specs/instrumentation.md` tabulates one per faculty) —
`holdMotion(h, part)` blanks a part's tape so it rests; `takeGrip` /
`holdGrip` give and hold a gripper's hold with no `grab` ever running;
`posePart(h, part, { rotation, length, cell })` moves a live pose with no tape
running; `clearFixtures(h, wheel)` takes a wheel's ring off the field;
`pauseRun` / `resumeRun`; `holdCompletion` / `allowCompletion`.

**The challenge** — `openChallenge(h, mode, index)`,
`openChallengeDocument(h, doc)`, `loadMachine(h, solution)`, `readMachine(h)`,
`referenceSolution(h, mode, index)`, and `openTitle` / `openHowto` / `openSelect`.

**The pointer** — `pressAt`, `moveTo`, `releasePointer`, `clickAt`, and
`drag(h, from, to, via?)` / `dragHex` / `dragFromTray` as one call. These go
through the surface and take effect **at the call**, so a whole machine is built
without advancing the game. `h.mousePress` / `h.mouseGlide` / `h.mouseRelease`
are the slow siblings that drive the real device one frame at a time, for the
checks that read what a _frame_ did with a gesture.

**The keyboard** — `pressAction(h, action)` presses the key
`specs/controls.md` binds; `holdAction` / `releaseAction`; `toggleOverlay(h)`.

**The run** — `playAction`, `stepAction`, `backAction` drive it the player's way;
`h.debug.startRun()` / `stopRun(h)` / `setSpeed(h, i)` pose it through the
surface. The two are different on purpose: `startRun` skips the readiness
condition the `play` action applies.

**Cues** — `watchCues(h)` collects every sound stamped with its frame;
`cuesOf(played, cue)` filters by name **where the name is observable**, which is
under either engine — under no engine every cue's name is `null` and it answers
every sound in the window, so an engineless check fences its window with silence.
`h.sounds()`, `h.loopingSounds()`, `h.loopStarts()`, `h.armAudio()`.

**What a frame drew** — `h.frameCalls()` / `h.lastCalls()` hand back the
operations, and `drawing.ts` reads them: `imageDraws`, `imagesNear`,
`distinctSources`, `drawnText`, `drewText`, `textDraws`, `textIn`, `drawnPoints`,
`drawOps`. `h.imagePixels(id)` reads a drawn source's own pixels back, which is
how a sprite is identified — never by matching a path.

**What a frame left** — `h.pixel`, `h.pixels`, `h.pixelRect`, `h.viewport`,
`h.device`, `h.css`, `h.surface`, and `color.ts`'s samplers.

**Media** — `captureStill(h, outputId)` and
`captureReplay(h, outputId, scenario)` for a point whose evidence is the game;
`writeImageBytes(outputId, png)` for a point about a produced FILE, whose
evidence is a picture of that file. All three are no-ops outside a run. A replay
brackets its behavior with `RECORDING_RUN_UP` and `RECORDING_SETTLE` — see below.

**Produced files** — `assets/files.ts` is the table (every path, canvas and frame
count, derived from `../constants`); `assets/sprites.ts` decodes and measures
them; `assets/sounds.ts` and `assets/bed-audio.ts` read the cues and the bed;
`assets/particles.ts` hands a system to `@clockwyrks/particle-runtime`;
`assets/rebuild.ts` rebuilds the workspace with the six generation tools replaced
by shims; `assets/runtime-import.ts` finds the runtime's `./canvas` binding in the
build's own source.

## Two engine differences a suite must know about

1. **Under no engine, `advance` does not deliver input.**
   `specs/instrumentation.md`: "Drawing and input are unaffected by the switch
   either way: the loop keeps rendering and keeps reading the keys." So the
   build's OWN loop is what delivers a press, and `none/harness.ts`'s `tap`,
   `holdFor` and the mouse helpers run one driven frame _and_ one of the build's
   own frames with the key still down — which covers both conformant designs.
   Exactly one frame of simulation passes either way, so a suite counting frames
   counts the same number in all three projects.

2. **`h.skip(n)` closes no recorded frame under no engine and does under either
   engine.** The simulation is identical; the difference reaches a capture's
   frame budget and therefore the EVIDENCE, never a verdict.

## A category may own a private helper

A directory of suites may hold one non-suite module beside them, named by the
thing it arranges rather than by a review item, and no manifest entry points at
it. `collision/examples.ts` is the first: the eleven worked configurations of
`specs/simulation.md`'s collision table, each posed once and handed back as ids,
because several of them back more than one item — example A backs the freeze rule
and two fault-payload items as well as its own, and example G backs "a collision
names no part". Writing the geometry once means the figures a check leans on are
the figures the specification wrote down.

Such a module **arranges and asserts nothing**. The suite that called it reads the
verdict, so a helper can never decide a point, and it is the same text in all
three projects like everything else that is not `harness.ts` or `surface.ts`.

## Four ways a suite decides nothing, and the rule for each

Each of these was found in the collision pilot and fixed there; the fix is the
precedent for the remaining categories.

1. **A "clear" item that a motionless build passes.** Examples B, C, E and F each
   assert only that the cycle reached its boundary with no fault — which a build
   whose carries move nothing satisfies, because nothing ever comes within `38`.
   Every check whose verdict is _no fault_ also reads back that the configuration
   really ran: the carried mote on the hex the motion table lands it on, and the
   resting mote still on its own. Examples H and J had that reading from the
   start; the other four now do.

2. **`sim.fraction` read for equality, including against `0`.** The three figures
   `specs/instrumentation.md` carries as running sums "agree to within the
   rounding of that sum rather than bit for bit", and `0` is a value of that sum
   like any other. Every read goes through `assertNear(…, FRACTION_TOLERANCE)`.

3. **A snapshot record deep-equalled against an object literal.** `assertDeepEqual`
   compares entry counts, so `[{ part, spoke, mote }]` fails a build that carries
   a fourth field on a grip — which no sentence of `specs/` forbids. Deep-equal
   the ID LISTS the specification fixes (`sim.fault.parts`, `sim.fault.motes`,
   whose order and membership are stated) and read a record through the readings
   in `snapshot.ts` (`heldBy`, `poseOf`, `tallyOf`) plus a length.

4. **Two absent readings compared with each other.** `assertDeepEqual(poseOf(after,
p), poseOf(before, p))` passes when the build reports no pose for `p` at all.
   Assert the reading is there before comparing it. The same trap is in
   `h.until`: a sweep that ran out of frames answers `hit: false` and hands back
   a snapshot anyway, so read `hit` before reading the snapshot.

## Tolerances come from `constants.ts`

`assert.ts`'s comparisons take an absolute span, and every span a suite passes
comes from `../constants` so the pair a reviewer reads is the case's figure beside
the build's. Two the run checks need constantly:

- `sampleFraction(k)` — the collision rule's `t = k / COLLISION_SAMPLES`, which is
  what `sim.fraction` reports after a run froze on sample `k`.
- `FRACTION_TOLERANCE` — how near a read of `sim.fraction` must land.
  `specs/instrumentation.md` carries `sim.fraction` as a running sum of the
  frames' own delta times, which "agree to within the rounding of that sum rather
  than bit for bit", so a fraction is never read for equality.

## A replay brackets its behavior, never the instant

A `replay` is what a REVIEWER watches, so it is armed once the world is posed and
disarmed once the behavior has played out, with a short run-up before and a short
settle after: the reviewer sees the behavior arrive and sees what it left behind.
An act that closes one frame — a press, a release, a pose read back — records one
frame if it is wrapped on its own, which is a still filed under a moving name.

Both figures come from `constants.ts`, stated in the `FRAMES_PER_CYCLE` a cycle is
watchable at, so every recording in the case brackets its moment the same way:

```ts
await captureReplay(h, "stepped", async () => {
  await h.advance(RECORDING_RUN_UP);
  await stepAction(h);
  await h.advance(RECORDING_SETTLE);
});
```

**Neither may change a verdict**, which decides how a suite spends them:

- **A world that does not move through them takes them as frames.** A paused run,
  a completed one, an editor with no run at all — the frames run and nothing the
  check reads moves.
- **A world that WOULD move divides the span it was already driving.** `specs/`
  fixes no timestep and "an interval of game time reaches the same state however it
  was divided into frames", so `advanceFraction(h, 1 / 2, RECORDING_RUN_UP)` runs
  the same half cycle the check always ran, watched rather than jumped.
- **A run that must not advance is HELD.** `pauseRun` either side of the acting
  frame buys the run-up and the settle without crossing a boundary.
- **A reading taken off a frame number moves inside the bracket.** A check that
  counts the frame a cue sounded on takes that frame past the run-up and reads the
  cues before the settle, so what it reports is still the act's own doing.

## Running one engine's suites against its reference

The projects are written to sit **beside** the build's `src/` and `assets/`, which
is where the runner stages them. To run them by hand, stage the project into a
copy of the reference workspace the same way:

```sh
CASE=test-cases/full-stack/medium/orrery/v1.0.0
ENGINE=simple-2d                      # or structured-2d, or none
WORK=/tmp/orrery-$ENGINE

REF="$(realpath "$CASE/references/$ENGINE/base")"

rm -rf "$WORK" && mkdir -p "$WORK"
# The reference workspace, linked in place — node_modules and dist included, so
# nothing is installed or built twice.
for f in $(ls -A "$REF"); do ln -s "$REF/$f" "$WORK/$f"; done
rm -f "$WORK/validation" && mkdir -p "$WORK/validation"
cp -r "$CASE/validation/$ENGINE/." "$WORK/validation/"
# The engineless project alone needs the shared harness staged beside its own.
[ "$ENGINE" = none ] && cp -r packages/case-harness/src "$WORK/validation/case-harness"

cd "$WORK"
npx tsc --noEmit -p validation/tsconfig.json          # type-check
npx vitest run --config validation/vitest.config.ts   # run every suite
npx vitest run --config validation/vitest.config.ts validation/sigils   # or some
TCAB_VALIDATION_MEDIA_DIR=/tmp/orrery-media \
  npx vitest run --config validation/vitest.config.ts   # and collect the media
```

`npx playwright install chromium` is needed once for the `none` project, and its
`dist/` must be built (`npm run build` in the reference) because the project
serves the built site.

**Every item's script exists in all three projects, so the case resolves and
`tcab validate` runs it.** The case resolves as a whole, so a single missing file
would refuse the whole command:

```
test case `orrery@v1.0.0` is invalid: review category `instrumentation` item
`surface-present` validation script `instrumentation/surface-present.test.ts` is
not a file in engine `none`'s validator project (`validation/none/`)
```

The staging recipe above is how one directory of suites is run without going
through the runner, and `TCAB_VALIDATION_MEDIA_DIR` is how its declared outputs
are collected and looked at — one file per output, at
`$TCAB_VALIDATION_MEDIA_DIR/validation/<suite path>/<output id>.{png,json.gz}`.

The `none` project's `validation/tsconfig.json` extends `../tsconfig.json`, which
is the **build's** tsconfig — that is why the project must be staged beside the
build rather than type-checked in place in this repository.
