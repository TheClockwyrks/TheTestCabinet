# `@clockwyrks/case-harness`

The shared validation harness a test case's validator project is built on, on
**every engine**: the frame loop a check drives, the draw-command recorder, the
debug surface and the stand-in for a missing one, and the readings a check makes
over what a frame left behind.

## What this is

A case is validated the same way whichever engine it is built on: pose the game
through the debug surface `specs/instrumentation.md` told the build to install,
drive it one frame at a time, and read what it drew. That machinery is the case's
_harness_, and it used to be copied whole into each case's `validation/<engine>/`
directory — once per engine, per case. This package is the one copy.

It has two halves, because there are two genuinely different ways to reach a
build:

- **Engineless (`none`) — the top level of `src/`.** With no engine there is
  nothing to import: the run seeds no `src/` at all, so the build wrote its own
  frame loop, its own canvas fit, its own keyboard, its own audio and its own
  debug surface, and the only place all of that exists is a page that has loaded
  the bundle. So the harness serves the built site, holds one Chromium, and
  drives the build across a crossing.
- **Engine-backed — `src/engine/`.** Under an engine a check runs in the SAME
  PROCESS as the build: it imports the engine and the build's own modules,
  constructs an engine over a canvas the harness owns and a clock the check
  chose, and steps the game with `engine.advance`. Nothing drives a browser,
  nothing polls, and no wall-clock time passes.

What stays with the case is what is genuinely the case's: its handle
(`window.__refract`) or its engine's construction, the operations its
specification requires, its snapshot and debug-surface types, its stage size and
tick rate, and every helper that reads its own game. Those arrive here as
**types by generics** and **values by config** — one config object, threaded
through one factory, per half.

### The engine half names no engine, and cannot

There are four engines — `simple-2d`, `structured-2d`, `simple-3d`,
`structured-3d` — and a case's validator project has exactly one of them on its
import graph. If this package named one, every case on the other three would
carry it into its project for nothing, and a fifth engine would mean editing this
package to add it.

So the engine half adds a third rule to the two above: **the engine arrives as
values too.** `createEngine`, the clock, the game definition, the background, the
layout — the case closes over all of it and hands it to the kit as functions.
What this package knows about an engine is the structural contract in
`src/engine/contract.ts`: the members all four engines carry, member for member.
A fifth engine needs no change here at all.

## How it reaches a case

There is no build step. The package publishes its TypeScript **source**, which
`crates/core`'s vitest validator copies into the staged validator project beside
the case's own files, so the same relative import resolves both in the checkout
and in a run. Anything that needs compiling would need a compiler in the staged
tree, and there is none.

## Two rules this package lives by

- **It ships no `*.test.ts`.** A case's vitest include is
  `validation/**/*.test.ts`, and this package lands inside that tree, so a test
  file here would be collected by every case's run. The package's own suite lives
  in `test/` — outside `package.json`'s `files` — and is named `*.spec.ts`. It is
  also the only place this machinery is self-checked: a case's `validation/` tree
  carries the suites its review items name and nothing else, so a case writes no
  harness self-check of its own.

- **It never reaches a run repository.** It is staged into the host package store
  beside the engine runtimes, and read only _after_ the run's container is gone.
  It is deliberately absent from `SHIPPABLE_PACKAGES` in
  `crates/core/src/test_case.rs`: a case that could name it in its manifest's
  `packages` key would vendor the validators into the run repo and hand the model
  the tests.

## How an ENGINELESS case wires it up

Four files in a case's `validation/none/` directory, and nothing else changes —
every suite goes on importing `../harness` and `../assert`, which become thin
re-exports.

```ts
// harness.ts — the kit, plus everything that is genuinely this case's
import { createCaseHarness, type Harness as BaseHarness } from "./case-harness";

const kit = createCaseHarness<RefractSnapshot, RefractDebugApi>({
  slug: "refract",
  handle: HANDLE,
  requiredOps: REQUIRED_OPS,
  step: { kind: "seconds-frames", op: "advance" },
  stage: { width: STAGE_W, height: STAGE_H },
  arm: { kind: "click", x: 2, y: 2 },
  tickHz: 60,
  projectRoot: dirname(fileURLToPath(import.meta.url)),
});
export const { createHarness, captureReplay, captureStill, watchCues } = kit;
export type Harness = BaseHarness<RefractSnapshot, RefractDebugApi>;
```

```ts
// assert.ts
export * from "./case-harness";
```

```ts
// setup.ts — registering is a call, never a bare import
import { registerWorkerTeardown } from "./case-harness/setup";
registerWorkerTeardown();
```

```ts
// globalSetup.ts
import { makeGlobalSetup } from "./case-harness/global-setup";
export default makeGlobalSetup({ slug: "refract" });
```

```ts
// vitest.config.ts
import { defineValidationConfig } from "./case-harness/vitest-config";
export default defineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
  testTimeout: 60_000,
});
```

### Why two of those are not imported through the barrel

`src/index.ts` re-exports every module _except_ `vitest-config` and
`global-setup`. Those two are loaded by vite's own config path, before the test
runtime exists, and they are the two files whose failure mode is "the project
would not load at all". Reaching them through the barrel would drag the whole
package — the harness, the media writer, Playwright's types, `vitest/config` and
the vite graph behind it — into every worker that imports anything, for two
functions no suite ever calls. So they are imported by their own specifiers.

### The two roots that must come from the case

Neither can be derived from this package's own `import.meta.url`, because the
package is staged one directory deeper than the case's files. Both failures are
silent or total, and neither is caught by a compiler.

- **`CaseConfig.projectRoot`** addresses a produced output. Derived here it would
  address every replay and still one directory too deep — and both writers
  swallow what goes wrong with a write, so the outputs would simply stop turning
  up. It is a required field, and a root the running suite is not inside throws.
- **The build root** is read off vitest's `TestProject` (`project.config.root`),
  never from a file URL. Derived here it would name the staged validator project,
  find no `dist/`, and throw — and a `globalSetup` that throws takes down the
  whole project, leaving every point the run's validators decide undecided.

## How an ENGINE-BACKED case wires it up

Three files in a case's `validation/<engine>/` directory — there is no
`globalSetup.ts` and no `setup.ts`, because an engine project stands nothing up
and has nothing to give back. Every suite goes on importing `../harness` and
`../assert` exactly as it did.

```ts
// harness.ts — the kit, plus everything that is genuinely this case's
import {
  createEngineCaseHarness,
  identityDriver,
  type EngineHarness,
} from "./case-harness/engine/index";
import { makeReplayCapture } from "./case-harness/engine/2d";

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

const kit = createEngineCaseHarness<
  RefractSnapshot,
  RefractDriver,
  RefractEngine,
  WorldModel
>({
  slug: "refract",
  projectRoot: PROJECT_ROOT,
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  surfaceRequirement: SURFACE_REQUIREMENT,
  recorder: { measureText: true },
  defaultClock: () => new ConstantClock(TICK_MS),
  createEngine: ({ canvas, clock, surface }) =>
    createEngine<RefractSurface>({
      canvas,
      width: STAGE_W,
      height: STAGE_H,
      game,
      background: BACKGROUND,
      layout: LAYOUT,
      clock,
      surface,
    }),
  driver: (_engine, raw) => identityDriver(raw as RefractSurface),
  snapshot: (debug) => projectCells(debug.snapshot()),
  toLogical: (engine, x, y) => engine.world.camera.worldToLogical({ x, y }),
  pointerPrecision: "device-pixel",
  extend: (_base, engine, initialized) => ({
    get world() {
      return engine.world;
    },
    get state() {
      return engine.world.state;
    },
    instance: initialized as GameInstance<RefractSurface>,
  }),
});

export const createHarness = kit.createHarness;
export const captureStill = kit.captureStill;
export const captureReplay = makeReplayCapture("refract", PROJECT_ROOT);
export type Harness = EngineHarness<
  RefractSnapshot,
  RefractDriver,
  RefractEngine
> &
  WorldModel;
```

```ts
// assert.ts
export * from "./case-harness/assert";
```

```ts
// vitest.config.ts
import { defineEngineValidationConfig } from "./case-harness/engine/vitest-config";
export default defineEngineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
});
```

### The three barrels, and what a case may not drag in

| Specifier                     | What is in it                                                                                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `./case-harness/engine/index` | Everything true of all four engines: the contract, the key and pointer events, the surface read and its stand-in, the three drivers, the canvas and its recorder, the draw-log bound (`boundDrawLog`), the asset host, the audio host, the evidence writer, and the kit. |
| `./case-harness/engine/2d`    | The 2D-only readings: pixels, colours and placed text over the canvas, and the replay stack that thins and re-tables a 2D engine's draw-op recording.                                                                                                                    |
| `./case-harness/engine/3d`    | The 3D-only pieces: the WebGL2 stub a `THREE.WebGLRenderer` stands up over, and the `self` its disposal path reaches for.                                                                                                                                                |

**A 3D case must not drag in the 2D replay stack, and a 2D case must not drag in
the WebGL stub.** That is not tidiness. A 3D engine's `stopRecording` answers a
PROMISE of VP9 video and its contract declares no `DrawOp`, `DrawState`,
`PathSegment` or `CapturedImage` at all, so the 2D replay stack has nothing to
operate on there; a 3D case captures stills only, through the neutral writers,
and says so where its `captureStill` is declared.

The line falls in one perhaps-surprising place: **the canvas and its recorder are
neutral**, not 2D-only. All four engines draw through a 2D context — the two 3D
ones over a `@napi-rs/canvas` SCREEN layer beside their WebGL stub, which is
where their HUD is really drawn and what their stills are encoded from. A STILL
is neutral for the same reason. The REPLAY is what is 2D-only, which is why it is
bound by `engine/2d`'s `makeReplayCapture` rather than carried on the kit.

`./case-harness/index` — the ENGINELESS barrel — must not be imported by an
engine project at all: it re-exports the Chromium half, and an engine validator
project has no Playwright in its tree. An engine case names the modules it wants
(`./case-harness/assert`, `./case-harness/color`, `./case-harness/text`).

### Why `engine/vitest-config` is not in the barrel either

Same rule as `vitest-config` and `global-setup` one level up, and stated again in
its own file rather than inherited: it is loaded by vite's own config path before
the test runtime exists, and it is the file whose failure mode is "the project
would not load at all". Reaching it through `engine/index` would drag the kit,
`@napi-rs/canvas` and the whole vite graph into every worker that imports
anything, for one function no suite ever calls.

### Serving a build's produced files

A build under an engine loads its produced sprites, models and cues through the
ENGINE's loader, which resolves each path into a URL relative to the page and
hands it to `globalThis.fetch`. Under an engine there is no page, and Node's
`fetch` refuses a relative URL outright — so without a shim every produced file
would fail to load, and a build whose `initialize` awaits its loads (which is what
every `specs/assets.md` tells a build to write) would never initialize at all,
costing the run EVERY item for a fact about Node.

Two modules close that, both in `engine/index` because both halves need them and
neither needs a different one:

```ts
// harness.ts
import {
  installAssetHost,
  installAudioContext,
  wavAudioBuffer,
} from "./case-harness/engine/index";

const host = installAssetHost({
  workspaceRoot: WORKSPACE, // never derived here — see below
  roots: [".", "public", "dist"],
  images: true,
  label: "orrery",
});
installAudioContext({ decode: wavAudioBuffer });
```

| What it supplies                    | Where it is                                 |
| ----------------------------------- | ------------------------------------------- |
| `fetch`, over the workspace on disk | `engine/assets` — `installAssetHost`        |
| `createImageBitmap` + `ImageBitmap` | the same call, `images` / `nameImageBitmap` |
| `document.createElement("canvas")`  | the same call, `documentElement`            |
| `AudioContext`, decoding only       | `engine/audio` — `installAudioContext`      |
| The RIFF/WAVE parser                | `engine/audio` — the two `decodeWav*` below |

**A DECODE THAT THROWS COSTS THE PROJECT, NOT THE POINT.** `wavAudioBuffer` and
`silentAudioBuffer` both parse RIFF/WAVE and **throw** on a body that is not one
or that carries no `data` chunk — and under an engine that is not a failed
decode, it is a failed run. `specs/assets.md` has a build bind its cues from
`initialize`, so a rejected decode leaves the cue undeclared and the build's own
`play` throws from inside `update`: one malformed produced file and EVERY point
in the project falls over, rather than the one asset point that file belongs to.
**No reference can show you this**, because nothing a reference commits is
malformed, so the verdicts do not move and the change is invisible until a real
build ships a bad file. `tolerantAudioBuffer(bytes, options)` is the other half:
a file it cannot parse comes back as one second of silence at
`UNREADABLE_SAMPLE_RATE`, exactly as the hand-rolled stubs in orrery, volute,
facet and gantry all did, and `samples: "decoded"` chooses whether a READABLE
file answers its real samples or silence of the right length. Which half a case
binds is a real choice and not a default this package may make: a case whose
specification says an unreadable cue is a failed build wants the throwing pair;
a case that grades the file through an asset point of its own wants this one.
Facet's two engine projects, which hand `api.audio.load` a decode that cannot
fail, are the case this was written for.

**`workspaceRoot` must come from the case**, for the same reason
`EngineCaseConfig.projectRoot` must: this package is staged one directory DEEPER
than the case's files, so a root derived from its own `import.meta.url` would
address a tree one level too far down and every produced file would quietly 404 —
and a 404 is a verdict about the build.

**The root ORDER is a config value with an explicit default, because it decides
which file answers.** A build is free to arrange its produced tree, so the first
root that carries a path wins: the four harnesses this came from bound
`[".", "public", "dist"]`, `["public", "dist", "."]`, `["", "public", "dist"]`
(where `""` is `"."`) and — in facet's shared `dom-shim.ts` —
`["dist", "build", "out", "public"]`, which is the built output FIRST. Folding
those would have a case reading its staged copy for its committed one with nothing
to say so. `DEFAULT_ASSET_ROOTS` is `[".", "public", "dist"]` and every other order
is one field.

**Two more things the cases disagreed about are config, not defaults.**
`onMissing` is `"404"` — the honest answer a served page gives, and what makes an
engine announce `asset:failed` with a status — or `"upstream"`, which hands the
URL to the platform's own `fetch` as orrery, volute, kessler's `simple-2d` and
wick's `simple-2d` do. `onlyUnder` narrows the shim to one prefix, which is
arc-foundry's `assets/` and nothing else, so a project whose own modules are
loaded by vite is not answered for by this.

**Request logging is available, never mandatory.** The handle carries the whole
log — `requests()`, `urls()`, `mark()`, `requestsSince(mark)`, `clear()` — because
under an engine this shim IS the whole of the build's transport, where under `none`
the same reading comes off the page's resource timings. A case that never asks
pays one small object per fetch.

#### The teardown contract, and two harnesses in one worker

The shims go onto `globalThis`, which is the whole of the process a worker's
suites run in. So:

- **One installation per worker, shared and REFERENCE COUNTED.** A second
  `installAssetHost` joins the standing one and answers a fresh handle over the
  same log; every handle's `uninstall` gives up one hold, and the globals go back
  only when the last one does. That is what a project installing from
  `createHarness` and uninstalling from `dispose` needs — deepcore's pair already
  counts references for exactly this reason — because two overlapping harnesses
  would otherwise have the first `dispose` pull the shim out from under the
  second.
- **A second install that DISAGREES throws**, naming the field and both values,
  rather than quietly serving the first caller's tree. Two harnesses of one
  project always agree, because their options come from one config object.
- **`uninstall` is idempotent per handle**, and restores each global to the
  descriptor it found — which on a bare Node process means DELETING all of them,
  since none existed. Nothing calls it automatically: a worker that simply exits
  leaves the shims standing, which is what most of the harnesses this came from
  do.
- `installAudioContext` counts references the same way, answers one teardown
  function, and throws on a second install that names a different `decode` — the
  worse half of the same mistake, because a harness that asked for
  `wavAudioBuffer` and joined a context decoding through `silentAudioBuffer` would
  read SILENCE off every channel with nothing to tell it so. It installs only
  where the host has none unless `replace` says otherwise, so a host that really
  carries Web Audio keeps the decoder that really works.
- `standingAssetHost()` answers a READ-ONLY view for a suite that wants the log
  without holding the handle: it takes no reference, and both `uninstall` and
  `clear` do nothing through it, so reading can neither pull the shims down under
  the owning harness nor empty the record that harness is about to read.

### The three driver strategies

A case does not choose one of these. Its engine's state model does.

| Strategy         | The state model that forces it                                                                                                                                                  | What a check holds                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identityDriver` | A structured engine: `Engine<D>` with `instance`, `world`, `renderer`. Its surface is already imperative.                                                                       | The object the build returned, untouched.                                                                                                                                   |
| `promiseDriver`  | The same imperative surface, where the case shares one suite with an engine whose driver must be asynchronous.                                                                  | Every member answering a promise — one microtask, against two copies of every check.                                                                                        |
| `applyDriver`    | A simple engine: `Engine<S, D>` holds the state BY VALUE, so the surface is PURE — a pose is `(state, …args) => State`, a reading is `(state) => R`, and neither has the state. | A reading handed `engine.state`; a pose run through `engine.apply`. Needs the case's `READINGS` list, because nothing about a pure surface tells the two apart at run time. |

### The one root that must come from the case

`EngineCaseConfig.projectRoot` addresses a produced output, and this package is
staged one directory DEEPER than the case's files — so a root derived here would
address every replay and still one directory too far down, silently, because both
writers are required not to raise. It is a required field, and a root the running
suite is not inside throws rather than misplacing a file where nothing will look.

## Two footguns, each invisible to the typechecker

Both were hit by more than one migration, neither fails to compile, and one of
them does not fail at all — it quietly answers a different number. Read these
before writing a `harness.ts` over the kit.

### An override that reaches for `base` reaches for ITSELF

`EngineCaseConfig.extend` does not build a new object around the kit's harness.
What it returns is laid over the kit's own object with
`Object.defineProperties(base, …)` — the SAME object, so that from that moment
`base.dispose`, `base.pointer`, `base.advance` and `base.cues` ARE the members
that were just written over them. A body inside an override that calls
`base.method()` therefore calls the override, and recurses until the stack goes.
The same is true of an engineless project that lays its members over
`kit.createHarness`'s result with `Object.assign` — and it must be laid over that
object rather than copied out of it, because `watchCues` remembers a harness by
its IDENTITY and a copy would be handed cue sinks nothing ever fills.

**Capture what you are overriding BEFORE you assign it**, by hand, while it is
still the kit's:

```ts
extend: (base, engine) => {
  // The kit's own teardown, taken before this object is laid over `base`:
  // what `dispose` below overrides IS `base.dispose`.
  const destroy = base.dispose.bind(base);
  return {
    dispose: () => {
      host.uninstall();
      destroy();
    },
  };
};
```

Wireworm's `simple-2d` hit it on `dispose` and spectra's on `pointer`; spectra's
`none` hit it on `runUntil`, which is laid over the very member it is built out
of, and facet's `simple-2d` holds `advance`, `dispose` and `cues` the same way so
that no later edit can reintroduce the loop by adding one more override. Where the
override RETURNS a value rather than throwing, the failure is not a stack overflow
but a wrong answer — which is how one of these turned a passing point into a
failing one and was caught behaviourally rather than by review.

### No transform is recorded at a `drawImage`

`RecorderOptions.measureText` stamps the transform in force beside a TEXT call,
because that is the one reading whose extent depends on the font as well as on the
geometry. **Nothing stamps one beside a `drawImage`.** The reading that was meant
to cover it is a WALK of the operation list — `save` pushes, `restore` pops, and
`transformed` composes the rest — which recovers the transform exactly, right up
until a build issues something the walk cannot see through: a `reset`, a
`setTransform` an engine's own fit issues, a `canvas.width` assignment.

A case whose rendering points turn on that matrix — a sprite required upright, a
leftward one required mirrored, a blit's placement under a rotation — takes it off
the real context instead. **Wireworm's `stampTransforms(h.calls, h.ctx)` is the
supported pattern**, and it uses only public surface:

```ts
const append = calls.push.bind(calls);
Object.defineProperty(calls, "push", {
  value: (...items) => {
    for (const item of items) {
      if (item.kind === "call" && TRANSFORMED.has(item.method)) {
        item.transform = matrixOf(ctx.getTransform());
      }
    }
    return append(...items);
  },
  writable: true,
  configurable: true,
  enumerable: false,
});
```

It wraps the calls array's own `push` — the same seam `boundDrawLog` uses, so the
two compose in either order and it wraps whatever is installed at the moment it
runs — and reads `h.ctx.getTransform()` off the real context as each call is
recorded. That is EXACT rather than approximate, because the recorder pushes the
entry BEFORE it applies the call to the context, so the transform stamped is the
one the call was made under. The resulting `DrawCall` is a strict extension of the
package's, so every reading the package ships over a recorded call (`callsTo`,
`setsOf`, `drawnText`, `textDraws`) reads it unchanged.

## What a case reaches for past the driven frame

Everything below is opt-in and costs a case that does not name it nothing at all.
None of it changes what a driven frame is: the frames are the same frames
`advance` runs, one step of the build's surface each, bracketed on the recorder
and stamped into the cue sinks the same way.

### A span the BUILD divides

`Harness.advance(n)` runs `n` frames by making `n` calls of one frame each, so
the harness fixes every boundary. `Harness.advanceSeconds(span, frames)` makes
ONE call — `op(span, frames)` — and leaves the division to the build, which is
the only way to pose `advanceSeconds(1, 1)` against `advanceSeconds(1, 60)`: the
same second of game time as one frame and as sixty, which is exactly what a
specification requiring delta-time independence says must reach the same state.
`Harness.skipSeconds` is the same call with no recorded frame kept, the way
`skip` is to `advance`.

The whole span closes as one recorded frame, because the harness cannot see where
the build put its own boundaries inside a step it did not drive; the clock is not
asked for a delta, because the CALLER named the interval. It is meaningful only
for a `"seconds-frames"` step and **throws** for a `"count"` one — a `count` build
is never told a duration, so there is no interval for it to divide, and a case
whose config and whose suite disagree is not something a build can cause or fix,
so it may not decide a point either way.

### Operations a build may omit

`CaseConfig.optionalOps` is a second list, probed but never required. A case with
VARIANTS whose specifications differ in what they instrument cannot put a
variant's operation in `requiredOps` — the surface probe would report every
conforming base build as missing one and leave every point in the run undecided —
and cannot leave it out of both lists either, or a variant build that owes it and
does not carry it fails with a raw `TypeError` from inside the page. So the
harness reads once, per page, which of them the build carries, and a call that
reaches a missing one fails by assertion NAMING it, on every route in:
`h.debug.x`, `Harness.arrange`, a sweep's `arrange`, and the `operations` a
`Harness.trials` declares.

### Init scripts on either side of the harness's own

`CaseConfig.extraInitScripts` runs a case's scripts AFTER the package's recorder
and audio probe, which is where everything that only needs to be there before the
BUILD belongs, and where it has always run. `CaseConfig.preInitScripts` runs them
BEFORE. The one reason to stand there is to need something the instrumentation
replaces: `recorder-init.js` swaps `HTMLCanvasElement.prototype.getContext` for
one that hands back a recording proxy, so a case script that must hold the page's
real `getContext` has to have taken it first. Run in the other order such a script
is not broken loudly; it is broken quietly.

### Deltas a sweep hands back

`Clock` gained an OPTIONAL `rewind(frames)`. An in-page sweep runs its frames in
the page, so it has to draw every delta it might run before the crossing opens;
one that stops early hands the rest back, or a `SequenceClock` would resume
mid-pattern and a `JitterClock` at the wrong index and a check whose whole claim
is that its failing case replays would not replay. It is optional because
`HarnessOptions.clock` accepts any object of the shape and the cases write their
own — deepcore's `PacedClock`, meltdown's `CoastClock`, orrery's `TunableClock`
are each a dozen lines implementing `delta` and nothing else — so requiring it
would stop every one of them compiling for a member most would write as a no-op.
The three clocks this package ships all carry it.

### The gesture, at a moment of the check's choosing

`HarnessOptions.armAudio` fires the arming gesture in the one place the harness
controls — before the opening `reset`, with settling frames after it, so the
restore erases whatever it moved — and is unchanged. `Harness.armAudio()` is the
same gesture and nothing else: no settling frames and no reset, because it is
called at a moment the harness arranged nothing about and repairing the state
afterwards would erase the check's own arrangement along with the gesture's. A
case reaching for it is stating that its gesture is inert where it stands.

### One crossing instead of N

A crossing into the page is a round trip to the browser, and what a round trip
costs is a fact about how busy the HOST is rather than about the build. A
scenario that poses forty drones one call at a time, or sweeps a hundred frames
one round trip apart, has made its own verdict a reading of the load average.
Four members do the whole of such a scenario in one crossing:

| Member                                                  | What it does in the one crossing                                                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `arrange(calls)`                                        | Runs a batch of surface calls in order and reads the state they left. Nothing advances.                                                                                                    |
| `sweep(predicate, argument, options)`                   | `until`, with the predicate decided in the page. `options.arrange` runs first, in the same crossing, and the state it left reaches the predicate and comes back as `SweepResult.arranged`. |
| `samples(frames, { project, argument, stop })`          | One reading per frame, `frames + 1` of them, or fewer when `stop` ends it early — the reading it held on is kept.                                                                          |
| `trials(rounds, { stage, read, argument, operations })` | Pose, one frame, read — `rounds` times, each round arranged from the previous round's reading.                                                                                             |

A batch is typed against the case's own surface operation by operation
(`SurfaceCall<D, Excluded>`), so `["setDroneBand", 3, "low"]` is checked exactly
as the direct call it replaces would be. Every function a check hands in is
carried into the page **as source**, so each must stand on its own: it sees the
parameters it is handed and nothing else, and anything from the suite reaches it
through `argument`, which crosses as JSON. A function that reaches for a binding
of the suite's fails in the page and the check reports it, so the mistake is
loud.

Two things stop at that boundary. `CaseConfig.projectSnapshot` is a node-side
function, so the `Sample` and `Reading` values are taken in the page off an
UNPROJECTED state — only the `S` values these hand back are narrowed. And a
reading that appears both as what `read` answers and as what the next `stage` is
given is not one TypeScript can infer from the calls alone, so a case names it:
`h.trials<Reading, Argument>(…)`.

### A bound on the draw log

`boundDrawLog(h.calls, max)` (`src/engine/draw-log.ts`, exported from
`engine/index`) caps the recorder's log in place: past `max` entries an append
drops the oldest half. It is called on `EngineHarness.calls` right after
`createHarness`, by a case whose SWEEPS outrun its READINGS — cascade's two
engine projects, and meltdown's, wireworm's and floe's `simple-2d`. It is not a
recorder option and has no default, because the figure is a property of a case's
longest sweep rather than of recording: the harnesses that carried one disagreed
(`100_000` against `200_000`) and the rest carried none, so an unbounded log
stays the honest reading for a case that never runs long enough to notice. It
patches the array's own `push`, which is the same seam `stampTransforms` uses
below, so the two compose in either order. Wick's `structured-2d` names it and
declines it.

## Names that collided, and what each case binds

Forty-odd copies of this machinery drifted for as long as they existed — four
engineless ones, and one per engine per case — and the drift that matters is not
the code, it is the **names**. Readings were spelled the same way in two cases
and meant different things; others were spelled two ways and meant one thing.
Folding either kind together silently rescales a threshold or drops a call site,
and nothing type-checks a case's validator tree before it runs, so neither
failure has anywhere to surface.

So both halves of every genuine disagreement ship, under names that say which is
which, and a case binds the one it has always meant. The rule this follows is the
one `speedOverTicks`/`gainOverTicks` already set: **never silently pick a
winner.**

| Package name                                   | What it is                                                                                                                                                                        | Bound by                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `luminance(c)`                                 | Rec. 709 weighted, `0.2126r + 0.7152g + 0.0722b`                                                                                                                                  | refract, carom, volute (volute re-exports it; `luminanceMask` ranks by it)        |
| `meanChannel(c)`                               | The unweighted mean, `(r + g + b) / 3`                                                                                                                                            | fathom, as its own `luminance`                                                    |
| `meanColor(rect, keep?)`                       | The mean over a **rectangle**, skipping what `keep` rejects                                                                                                                       | volute                                                                            |
| `meanOf(pixels)`                               | The mean over a run of sampled **points**                                                                                                                                         | fathom, as its own `meanColor`                                                    |
| `drawnText(calls)`                             | The RAW `fillText`/`strokeText` strings, as a `string[]`                                                                                                                          | refract, carom, volute; fathom as its own `textRuns`                              |
| `drawnTextLines(calls)`                        | The LOGICAL runs those calls spell, as a `string[]` — a letter-spaced heading is one entry                                                                                        | refract, carom (its engine harnesses' `drewText`); `drewText` reads copy off this |
| `drawnTextRuns(calls)`                         | The same runs placed, as `TextDraw[]`; `textDraws` stays one entry per call                                                                                                       | refract                                                                           |
| —                                              | Fathom's `drawnText(ops)` — the runs upper-cased and joined into one string — is a **different function**, and stays in fathom's `states/screens.ts`                              | fathom                                                                            |
| `sampleColor(h, x, y, radius?)`                | The mean of a five-point cluster, `radius` out on the axes                                                                                                                        | refract, carom (both at the default `4`)                                          |
| `sampleDisc(h, x, y, radius)`                  | The mean over a disc; **the radius is required**                                                                                                                                  | volute, which supplies its own `CORE_RADIUS - 1`                                  |
| `darkestOf(h, points, radius?)`                | The darkest of several sampled patches: the bare ground                                                                                                                           | refract as `sampleBench`, carom as `sampleField`                                  |
| `brightestIn(samples, score, keep?)`           | The brightest of a neighbourhood; **`score` is required**, because the two luminances above pick different pixels                                                                 | fathom                                                                            |
| `mousePress` / `mouseGlide` / `mouseRelease`   | A real mouse gesture mapped through `Harness.css`, one driven frame each                                                                                                          | refract                                                                           |
| `Harness.movePointer` / `Harness.clickPointer` | The harness's own pair, mapped through `Harness.cssPoint` — unrounded, for the case that measures the fit itself                                                                  | volute                                                                            |
| `Harness.arrange(calls)`                       | A batch of surface calls run in ONE crossing, typed against the case's own surface as `[op, ...args]`, answering the SNAPSHOT they left                                           | spectra, as its own `pose`                                                        |
| —                                              | Cascade's `Harness.pose(calls)` — `{ op, args }` objects, answering what each call RETURNED — is a **different function**, and stays in cascade's own `harness.ts`                | cascade                                                                           |
| `Harness.samples(frames, …)`                   | A reading per frame, taken IN THE PAGE by a `project` carried in as source, in one crossing                                                                                       | spectra                                                                           |
| —                                              | Cascade's `Harness.sample(frames)` — the shared `stepWatching` under cascade's own name, one round trip per frame — is a **near neighbour of that name and not the same reading** | cascade                                                                           |

### The engine half's own collisions

Everything above came out of the four engineless harnesses. The engine half is
now bound by all fifty-four validator projects — eighteen cases, three projects
each — and extracting it turned up several times as many disagreements again,
many of them **inside one case**: between its two engine projects, or between an
engine project and the `none` beside it. Fathom, floe, meltdown and wireworm each
round a duration two ways; wireworm, meltdown, deepcore and spectra each count a
frame's draw operations or place its points two ways; gantry disagrees with
itself three times over. That is exactly how invisible this drift was.

There are more of them than one table serves, so they are grouped by what a
check is asking. The rule is unchanged: **never silently pick a winner.** A row
whose package name is `—` is a reading that stays with the case.

#### Text a frame drew

| Package name                | What it is                                                                                                                                                                                                                                         | Bound by                                                                                                                                                                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drewText(calls, text)`     | A substring of some LOGICAL RUN: the frame's text calls are merged into the runs they spell FIRST, so a heading drawn a glyph per `fillText` reads as the word it spells                                                                           | carom's and refract's three projects each (their engine ones import it as `spelledText` and re-export it under the shared name); coil's three, which re-export it outright; and the `none` project of cascade, floe, shatter, wireworm, meltdown, volute, wick, arc-foundry and deepcore                 |
| —                           | The SAME NAME over a RAW draw call — a substring of some single `fillText`/`strokeText` string, with no merging — is a **different question**, and stays with the case                                                                             | cascade's, floe's, wireworm's, meltdown's, volute's, wick's and deepcore's two engine projects; kessler's and spectra's three; shatter's `structured-2d`. Binding the package's here would quietly WIDEN what those points accept, because every run a build split across calls would start passing      |
| —                           | The same name again as an EXACT match, after `trim()` and upper-casing, over the raw calls — a screen entry that is the copy and not a screen that merely contains it                                                                              | shatter's `simple-2d`. The strictest of the three, and the only one a build cannot satisfy by drawing more                                                                                                                                                                                               |
| —                           | Facet's `showsText(pieces, wanted)` — FOUR readings tried from the most local to the most permissive: a piece that IS the copy, a piece that CONTAINS it, the frame's whole run of text joined, and that run with all whitespace out of both sides | facet's three projects, whose `drewText` is that function over the raw calls. The last two readings can find a phrase spanning two adjacent draws, so it decides that copy IS on screen and NEVER that two pieces of copy are separate — a bound the case states and the package's reading does not have |
| `drawnTextRuns(calls)`      | A merged run of text left at its FIRST DRAW's anchor                                                                                                                                                                                               | the engineless half                                                                                                                                                                                                                                                                                      |
| `reanchoredTextRuns(calls)` | The same run, re-anchored about the whole of what it spells, under that first draw's alignment                                                                                                                                                     | refract's two engine projects, as their own `drawnTextRuns`. The two agree exactly on a run of one draw and on any `start`-aligned run, and disagree on every centred or right-aligned MERGED run                                                                                                        |
| `textDraws` / `TextDraw`    | ONE ENTRY PER CALL, placed in canvas pixels: `{ text, x, y, left, right, align? }`, where `left`/`right` are the measured extent under `recorder: { measureText: true }` and collapse onto `x` without it                                          | carom's, cascade's, floe's, refract's, wireworm's, meltdown's and deepcore's two engine projects, spectra's, shatter's `structured-2d`, coil's and volute's projects — most under a local `TextSpan` alias                                                                                               |
| —                           | Wick's `TextDraw` — `{ text, x, y, width, textAlign, fontSize }`, the extent as a WIDTH rather than as two edges, and the font's pixel size beside it, in the call's own space                                                                     | wick's two engine projects. `fontSize` is the slack a reading with only an anchor to go on may allow either side of the glyphs, and the package answers no such figure                                                                                                                                   |
| —                           | Arc-foundry's `TextDraw` — `{ text, x, y, index }`, carrying the operation's INDEX in the frame's whole call list and NO extent at all                                                                                                             | arc-foundry's three projects, whose recorder is deliberately left unmeasured. `yard-drawing/waypoint-numbers-on-top` decides its point by comparing that index against `order.ts`'s, which is a fact about the ORDER of the render that the package's reading does not carry                             |
| —                           | Kessler's `TextDraw extends` the package's, adding `width` (`right - left`) and `textAlign` (`align`, defaulted)                                                                                                                                   | kessler's two engine projects. A strict extension rather than a disagreement: it is the package's placement under this case's names, which is what keeps `hud/hud-clear-of-field` reading what it was written to read                                                                                    |

#### Geometry, blits and the pixels they left

| Package name                        | What it is                                                                                                                                                                                                                                                                              | Bound by                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drawnPoints(calls)`                | Every point a frame's drawing calls named, mapped THROUGH THE TRANSFORM IN FORCE at each — where the geometry LANDED, in device pixels                                                                                                                                                  | carom's two engine projects; the `none` project of wireworm, meltdown, wick, deepcore and spectra; volute's three                                                                                                                                                                                                                                                                                                                |
| —                                   | The same points AS THE CALLS NAMED THEM, in the space the call was issued in — a **different reading**, and it stays with the case                                                                                                                                                      | floe's, spectra's, wireworm's, meltdown's and shatter's `structured-2d`, and deepcore's two engine projects. Under a structured pipeline the transform IS the world-to-device fit the pipeline already set, so mapping through it again answers in a space no check there speaks; under deepcore's own camera translate the question is what the build ASKED FOR rather than where it landed. The two agree only at the identity |
| `DRAW_METHODS` / `drawOps(calls)`   | The geometry calls a frame made, by name, and how many of them — FOURTEEN methods, `putImageData` among them                                                                                                                                                                            | carom's two engine projects; shatter's `none` and `structured-2d`; wireworm's and meltdown's `none`; volute's, wick's and deepcore's `none`                                                                                                                                                                                                                                                                                      |
| —                                   | The same list ONE ENTRY SHORT, without `putImageData` — a **different count**, and it stays with the case                                                                                                                                                                               | facet's three projects; floe's, spectra's, wireworm's and meltdown's `structured-2d`; spectra's `none`; deepcore's two engine projects. `drawOps` is a COUNT two frames of one scene are compared by, so a list carrying one more method moves every such comparison for a build that blits — silently, and in one direction. **A count is only ever compared against another count taken the same way**                         |
| `imageDraws(calls)`                 | Every image the frame drew, as an interned `ImageRef` naming the bitmap and a destination mapped through the transform in force, `dw`/`dh` as SIGNED EXTENTS. Answers an EMPTY array for a recorder not interning                                                                       | volute's `none`, wick's `none`, floe's `none`, deepcore's `none`                                                                                                                                                                                                                                                                                                                                                                 |
| —                                   | Kessler's `blitsOf(calls)` — the same walk answering an axis-aligned BOX around all FOUR mapped corners of the destination                                                                                                                                                              | kessler's two engine projects, whose `presentation/sprites-drawn-at-native-size` asserts on exactly those two numbers. The package's answer is the same CENTRE and a different `dw`/`dh` under any rotation, so the identity and the transform walk come from the package and the box is taken in the case                                                                                                                       |
| —                                   | Deepcore's `imageDraws(calls)` — the RAW argument lists (`callsTo(calls, "drawImage")`) and nothing else                                                                                                                                                                                | deepcore's two engine projects, where which SOURCE rectangle a call named is the reading (`sx / frameWidth` is the sheet frame the build is on) and the recorder is not asked to intern, so the package's would answer nothing at all                                                                                                                                                                                            |
| —                                   | `drawnImages(h)` — the SOURCE OBJECT ITSELF, its destination in the case's LOGICAL units, and `mirrored`; spectra's also carries the source `crop` rectangle and floe's the transform the context really held                                                                           | spectra's, wireworm's and floe's two engine projects. Their sprite points rasterize the source against the seeded PNGs, so the bitmap has to reach the check untouched — which is why the recorder is asked NOT to intern, and why the package's `ImageRef` cannot serve                                                                                                                                                         |
| —                                   | Arc-foundry's `imageDraws(calls)` — only where a blit LANDED, with no identity for the bitmap at all                                                                                                                                                                                    | arc-foundry's three projects, which ask nothing about WHICH bitmap and so do not turn interning on                                                                                                                                                                                                                                                                                                                               |
| `RecorderOptions.internImages`      | A drawn bitmap named from the SOURCE OBJECT's own `src`, and `kind` `"pixels"` for any source carrying a `data` member                                                                                                                                                                  | nobody yet. Under an engine `src` is a BUFFER on `@napi-rs/canvas`'s decoded `Image`, so it reads `src: null`/`srcHash: null`; and `Canvas` carries `data` as a METHOD, so a scratch canvas reads `"pixels"`                                                                                                                                                                                                                     |
| —                                   | Volute's own `imageRef`, which digests the URL `AssetHost.sourceOf` remembers and reads `kind` off `data instanceof Uint8ClampedArray`, is a **different function** of the same shape, and stays in volute                                                                              | volute's two engine harnesses, whose `presentation/produced-core-sprites` asserts `srcHash` is PRESENT on a produced sprite — which the package's reading answers `null` for                                                                                                                                                                                                                                                     |
| —                                   | Coil's `blitsOf(calls, smoothingAtOpen)` — the same `drawImage` walk, answering the box around all FOUR mapped corners plus `imageSmoothingEnabled` and the QUARTER TURNS the transform carried the sprite through — is a **different reading**, and stays in coil's three `harness.ts` | coil, whose `specs/assets.md` authors each sprite in one orientation and has it "rotated in quarter turns when it is drawn" and sampled with smoothing off. `imageDraws` carries neither fact, and its `dw`/`dh` are signed extents rather than a box; the two agree on the centre and on nothing else under a rotation                                                                                                          |
| `pixelsChanged(before, after)`      | How many BYTES differ between two whole-frame captures, with no tolerance: "did the build draw anything different at all"                                                                                                                                                               | refract, cascade, floe, shatter, spectra, wireworm, meltdown — the `structured-2d` side of each                                                                                                                                                                                                                                                                                                                                  |
| `pixelsDiffering(a, b, tolerance?)` | How many PIXELS of two rectangles moved by more than a tolerance — **which defaults to `8` per channel**                                                                                                                                                                                | the engineless half; volute's two engine projects. A threshold stated over one of these is meaningless over the other                                                                                                                                                                                                                                                                                                            |
| —                                   | Wick's `pixelsDiffering` — the same name at a DIFFERENT DEFAULT: exact equality, `simple-2d`'s taking no tolerance at all and `structured-2d`'s defaulting `eps` to `0`. Two rectangles of different shapes differ by the whole of the larger                                           | wick's two engine projects, every suite of which calls it with two arguments. Binding the package's would loosen every frame-against-frame comparison in the project by eight levels a channel without a call site changing                                                                                                                                                                                                      |
| —                                   | Facet's `patchDistance(a, b)` — the MEAN PER-PIXEL Euclidean RGB distance between two patches, 0 to about 441 — is a **third reading of the same family**, and stays with the case                                                                                                      | facet, whose checks ask only whether it is zero. A threshold stated over one of the three is meaningless over the others                                                                                                                                                                                                                                                                                                         |

#### Colour, and where a colour is sampled

| Package name                    | What it is                                                                                                                                                                                          | Bound by                                                                                                                                                                                                                                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `luminance(c)`                  | Rec. 709 weighted, `0.2126r + 0.7152g + 0.0722b`                                                                                                                                                    | arc-foundry's two engine projects, beside the engineless binders recorded above                                                                                                                                                                                                                      |
| —                               | The same name at REC. 601, `0.299r + 0.587g + 0.114b`, is a **different weighting**, and stays with the case                                                                                        | shatter's, spectra's and meltdown's `structured-2d`. The two differ by up to a fifth to a third of the scale on a saturated colour, and each of those projects RANKS a body's pixels by it, so folding them picks different pixels out of every mark the suite reads                                 |
| `sampleColor(h, x, y, radius?)` | The rendered colour at a logical point, the mean of a FIVE-POINT CLUSTER `radius` units out on the axes. **The default is `4`**                                                                     | carom's, cascade's, fathom's, floe's, refract's and wireworm's engine projects, and shatter's and spectra's `structured-2d` — the last four naming `4` explicitly                                                                                                                                    |
| —                               | The same cluster at the case's own radius: `2` (arc-foundry's two engine projects), `3` (spectra's `simple-2d`, meltdown's two), `6` (cascade's, wireworm's and spectra's `none`, deepcore's three) | each case, whose smallest sampled body fixes what "comfortably inside it" means. Arc-foundry's smallest is two units across, where deepcore's is a mine cell; a radius folded to one figure would read a neighbour on one case and an anti-aliased rim on another                                    |
| —                               | ONE DEVICE PIXEL, under the case's own name — kessler's `samplePoint`/`samplePolar`, shatter's `simple-2d` colour read — is a **different reading**                                                 | kessler's three projects and shatter's `simple-2d`. Shatter's bodies are line art a few units across on a dark field, and a five-point cross that wide lands off the figure as often as on it; every threshold in kessler's visibility and presentation suites was measured against the single pixel |
| `nearestTo(samples, reference)` | The barest of several patches, measured against a colour known from OUTSIDE the picture — the rasterized clear colour                                                                               | refract's `structured-2d`, as its own `sampleBackground`                                                                                                                                                                                                                                             |
| `medoidOf(samples)`             | The barest of several patches, measured against the other samples ALONE, with no reference colour                                                                                                   | refract's `simple-2d`, as its own `sampleBackground` — over four different points                                                                                                                                                                                                                    |
| `darkestOf(h, points, radius?)` | The barest of several patches, ASSUMING the ground is dark                                                                                                                                          | orrery                                                                                                                                                                                                                                                                                               |

#### Ticks, sweeps, and the bounds on them

| Package name                             | What it is                                                                                                                                                                                                                                                                                                                      | Bound by                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ticksFor(duration)` / `ticks(duration)` | Whole frames covering `duration` seconds, **ROUNDED UP**, so a hold stated in seconds always covers the whole of it. The two names are one function                                                                                                                                                                             | floe's, wireworm's and meltdown's `simple-2d`; fathom's `simple-2d`, as `ticks`; volute's and gantry's three projects each. Spectra's `simple-2d` writes the same reading out in its own body                                                                                                                                                                                                                                                                                          |
| —                                        | The same name ROUNDED TO NEAREST is a **different rounding**, and stays with the case                                                                                                                                                                                                                                           | floe's `none` and `structured-2d`; shatter's three; wireworm's `structured-2d` and its `none` as `framesFor`; spectra's `structured-2d` and its `none` as `framesFor`; meltdown's `structured-2d`. What moves is a tick either way at every duration that does not land on a boundary — floe's `HOP_COOLDOWN` is `14.4` ticks and answers `14` here and `15` there, and wireworm's `0.14 * 100` lands an ulp above `14`, which a ceiling turns into a fifteenth frame nobody asked for |
| —                                        | Fathom's `ticksFor(duration)`, which **THROWS** on a duration that is not a whole number of ticks rather than rounding it either way                                                                                                                                                                                            | fathom's `structured-2d`. The two agree on every duration that lands on a tick boundary and disagree on exactly the durations this one exists to refuse, so binding the package's would turn a refusal into a silently shortened march                                                                                                                                                                                                                                                 |
| `UntilResult.frames` / `.ticks`          | ONE counter under two names, both filled                                                                                                                                                                                                                                                                                        | fourteen cases count `.frames`; kessler, wick and volute count `.ticks`, where a frame IS a tick. Same for `UntilOptions.maxFrames`/`maxTicks`                                                                                                                                                                                                                                                                                                                                         |
| —                                        | Coil's `Harness.until` — whose `maxTicks` and whose `UntilResult.ticks` count WHOLE TICKS OF THE SIMULATION, each eight frames of its clock — is a **different sweep**, and stays in coil's three `harness.ts`. Its `tick(ticks)` is a DRIVE for the same reason, where the package's `tick()` is `frame()` under a second name | coil, whose `specs/movement.md` fixes a tick at `0.125` s and whose suites step at 64 Hz for exactness, so `FRAMES_PER_TICK` is `8`. Bound to the package's names, a sweep asked for 400 ticks would run 400 frames and report that a death it was driving toward never happened — so `Harness` OMITS both members rather than joining them                                                                                                                                            |
| `Harness.tick()`                         | A COUNTER — `frame()` under a second name, for a suite that counts in ticks                                                                                                                                                                                                                                                     | the cases that spell a frame a tick and read it back                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| —                                        | Kessler's `h.tick(n)` — a DRIVE of `n` whole ticks that also ANSWERS the snapshot they left — is a **different member under the same name**, and stays with the case                                                                                                                                                            | kessler's three projects, where one frame is one tick. It is `advance(n)` and `snapshot()` in one call, and the harness is a wrapper rather than the kit's `extend` precisely so `h.tick` cannot mean two things at once across a hundred and seventy-five call sites                                                                                                                                                                                                                  |
| `DEFAULT_MAX_FRAMES`                     | How far a sweep runs when the caller names no bound: **`600` frames**                                                                                                                                                                                                                                                           | volute's two engine projects, wick's `simple-2d` (as its `maxTicks` default) and shatter's two, each importing the figure by name                                                                                                                                                                                                                                                                                                                                                      |
| —                                        | The case's own figure: `1200` (arc-foundry's two engine projects; meltdown's `simple-2d`, as `SWEEP_LIMIT`), `400` ticks (coil's `none`, kessler's `none`), `240` ticks (coil's two engine projects)                                                                                                                            | each case. Nothing in meltdown rests on it — every sweep there names its own bound — but folding it into the package's would have quietly HALVED a bound a suite is entitled to leave unstated, and that is exactly the kind of change nothing would report                                                                                                                                                                                                                            |
| `TimedCue.frame` / `.tick`               | ONE counter under two names, both filled, on a cue stamped with the frame that was running when it sounded                                                                                                                                                                                                                      | most cases spell it `frame`; volute spells it `tick`                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Four cases disagree with THEMSELVES about that rounding. Floe, wireworm and
meltdown round UP in `simple-2d` and TO NEAREST in `structured-2d`; fathom's
`simple-2d` takes the package's `ticks` where its `structured-2d` refuses a
fractional tick outright. Each project keeps the one its figures were taken
under: `simple-2d`'s holds are stated as "at least this long", and
`structured-2d`'s windows were measured to the nearest whole frame.

#### The pointer

Six distinct events reach an engine's input system across the tree, and the
differences are almost all in what a MOVE reports. An engine reads a pointer
event structurally and falls back to its own default for a field that is absent,
so an event naming `button`/`buttons` takes a different path through the engine
than one that does not — which is why the package ships two and eleven of the
eighteen cases still keep their own in at least one engine project.
`EngineCaseConfig.pointerEvent` is the seam; leaving it unset gives
`PointerPositionEvent`, and a case that dispatches at `base.events` itself
bypasses the seam altogether.

| Package name           | What it is                                                                                                                                                                                                                                                       | Bound by                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PointerPositionEvent` | A pointer event carrying `clientX`/`clientY`/`isPrimary` and nothing else. An engine that reads `button`/`buttons`/`pointerType` finds them ABSENT and applies its own default                                                                                   | the kit's DEFAULT, so every project that leaves `pointerEvent` unset and drives the pointer through the kit: refract's `structured-2d`, volute's two, meltdown's two, deepcore's two, cascade's two, and facet's two — the last dispatching it by name. Deepcore states the reason plainly: its own `PointerEvt` carried these three fields and no others                                           |
| `DevicePointerEvent`   | The same, plus `pointerId`, `pointerType`, `button` and `buttons` — `button` `-1` on a move and `0` otherwise, and **`buttons: 1` on EVERY move**, which is a DRAG                                                                                               | refract's `simple-2d`, orrery's two, and spectra's `simple-2d`, which supplies its own `pointerId` (`2` for a touch contact) through the same config                                                                                                                                                                                                                                                |
| —                      | **The held-button mask**: the same seven fields, with `buttons` kept PER POINTER ID exactly as a browser keeps it — a press adds a button, a release drops one, and a move reports what is really still down. A hover with nothing pressed carries `buttons` `0` | carom's, fathom's, shatter's, wireworm's and coil's two engine projects, spectra's `structured-2d` (which also gives a finger its own `pointerId`), and gantry's `structured-3d`. `DevicePointerEvent`'s `buttons: 1` on a move is a drag the caller never began, and every one of these cases has a specification distinguishing a hover from a drag, a named button, or two simultaneous contacts |
| —                      | **A position and a DEVICE, and no button mask at all**                                                                                                                                                                                                           | arc-foundry's and kessler's two engine projects, and gantry's `simple-3d`. `PointerPositionEvent` names no device, and each case's `specs/controls.md` separates a touch contact from a mouse press; `DevicePointerEvent` states a mask these cases' readings were never taken under, and `pointer.md` says a hand-dispatched event carrying no mask is the right answer for the third              |
| —                      | Floe's `PointerDriveEvent` — `DevicePointerEvent` but for ONE FIELD: `button` `0` on every event of a gesture, where the package's reports `-1` on a MOVE                                                                                                        | floe's two engine projects. A structured engine takes a different path for a move that names no button, so the two are not interchangeable                                                                                                                                                                                                                                                          |
| —                      | Wick's event — `button` `-1` on a move as the package's, but an **EMPTY mask on a move** unless the caller asks for the held one (`buttons` is `1` only on a `pointerdown`)                                                                                      | wick's two engine projects. That difference is the whole of how the case tells a hover from a travelling contact — "a touch contact never hovers: only a device reporting a position while out of contact moves the highlight this way"                                                                                                                                                             |
| —                      | Gantry's two `PointerEvt` classes — its `structured-3d` states the mask that is really HELD (`buttons` `0` on a move with no press live), and its `simple-3d` states NO mask at all — are **two more different events**, and stay with the case                  | gantry's `structured-3d` and `simple-3d`. `DevicePointerEvent` states `buttons` `1` on every move, which the 3D engines' chord tracking reads as a drag the caller never began                                                                                                                                                                                                                      |
| —                      | Coil's `PointerShapedEvent` — which states the mask genuinely HELD by that pointer id, so a hover with nothing pressed carries `buttons` `0` — is a **fourth event**, and stays in coil's two engine `harness.ts`                                                | coil's `simple-2d` and `structured-2d`. `specs/ui.md`'s "a pointer arriving over an item selects it" is a hover, and every pointer verdict in that case was taken under the mask a real device reports                                                                                                                                                                                              |

#### Driving the surface, and a surface that is not there

| Package name                         | What it is                                                                                                                                                                                                                                                                                                                                          | Bound by                                                                                                                                                                                                                                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `applyDriver(engine, raw, …)`        | A pure surface threaded through `engine.apply`, where a READING is handed `engine.state` followed by the call's own arguments and answers its value DIRECTLY rather than as a promise                                                                                                                                                               | refract's `simple-2d`, carom's, and every simple-engine case whose checks read a value rather than await one                                                                                                                                                                                                 |
| —                                    | Orrery's own apply-threaded driver — every member answers a PROMISE — is a **different function**, and stays in orrery's `simple-2d/harness.ts`                                                                                                                                                                                                     | orrery's `simple-2d`, whose `OrreryDriver` is one interface in all three projects and whose engineless one genuinely has to wait. Its `structured-2d` binds `promiseDriver`, the package's half of the same disagreement                                                                                     |
| —                                    | Cascade's own apply-threaded driver — a THIRD class of member beside a pose and a reading, where `move` and `autoMove` answer `[nextState, verdict]` and the pair is SPLIT INSIDE the transition — is a **different function**, and stays in cascade's `simple-2d/harness.ts`, wrapped around the package's `applyDriver` for the other two classes | cascade's `simple-2d`. The pair may not reach `engine.apply` whole: the engine stores whatever a transition returns, so a stored tuple would BE the state from that frame on and corrupt every frame after it. `surface.ts`'s `VERDICTS` names the two members, exactly as its `READINGS` names the readings |
| `absentSurface(requirement, reason)` | A stand-in for a surface the build never returned, failing at the property ACCESS                                                                                                                                                                                                                                                                   | every ENGINE project — the apply-threaded driver decides pose-or-reading by `typeof`, and an `instrumentation` suite asks `typeof h.debug.op` outright, so answering a plausible function to a build that shipped nothing is how a check passes on nothing                                                   |
| `unexposedSurface(reason, fail)`     | The same stand-in, answering every member with a FUNCTION that fails when CALLED                                                                                                                                                                                                                                                                    | every ENGINELESS project — the surface lives in the page and every member is called across a crossing, so failing at the access would fail the harness's own probing before a check ran                                                                                                                      |
| —                                    | Gantry's own stand-in for an unusable surface — every member answering an ASYNC function that fails — is a **third spelling**, and stays with the case                                                                                                                                                                                              | gantry's three projects, whose `Harness` contract is that every member of `h.debug` answers a promise in all three directories, so a check that awaits reads a rejection rather than a synchronous throw its `await` did not expect                                                                          |
| `missingOps(raw, ops)`               | WHICH required operations a surface does not carry — a reading, and never a verdict, so a case chooses where the fault lands                                                                                                                                                                                                                        | gantry's `structured-3d` lands it AT THE HARNESS (one missing operation makes the whole surface unusable, so every point reports the same fault) and its `simple-3d` lands it PER OPERATION (only the missing one fails). Both are legitimate; they are a third disagreement inside one case                 |

#### Assertions

| Package name                              | What it is                                                                                                                                                                      | Bound by                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `assertNear(actual, expected, tolerance)` | Fails any NON-FINITE `actual` outright, and phrases its bound `expected +/- tolerance`                                                                                          | every project that re-exports `./case-harness/assert` whole, wick's `none` among them                                                                                                                                                                                                                                                                                                                                          |
| —                                         | The same name for a **different reading**: an early return on `actual === expected`, so two equal infinities are within every tolerance, phrased `within tolerance of expected` | wick's `structured-2d`, where twelve hundred call sites were written against it, and — under the DIFFERENT NAME `assertWithin`, so the package's is not shadowed — wick's `simple-2d`. Folding them would rewrite every failure message in the project and move the verdict on any figure that reached infinity                                                                                                                |
| `assertDeepEqual` / `assertContains`      | Structural equality over JSON-shaped values, `undefined`-valued entries dropped before the comparison                                                                           | most projects. **The comparison itself is private**, so each of these closes over whichever `deepEquals` its own module declared — and a case that wants `assertNotDeepEqual`, which this package does not ship, has to declare the comparison to build it on. That is why wick's two engine projects re-declare all three rather than re-exporting them: taking the shared helpers would take the shared comparison with them |

#### Audio, cues, and the asset log

| Package name                        | What it is                                                                                                                                                                                                         | Bound by                                                                                                                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `decodeWavChannels(bytes)`          | A `.wav` decoded to its SAMPLES, de-interleaved, one `Float32Array` per channel, each holding what the file holds                                                                                                  | orrery, under this name; volute, kessler's `simple-2d` and wick's `simple-2d`, each as its own `decodeWav`                                                                                                                                                                                    |
| `decodeWavHeader(bytes)`            | The same file read for its FIGURES ALONE — rate, channels, depth, frame count, duration — with nothing decoded, because nothing in that project listens                                                            | gantry's `structured-3d` as `decodeWav`, its `simple-3d` as `decodeWave`, wick's `structured-2d` as `wavHeader`. A threshold stated over one is meaningless over the other: read a channel of the second and every sample is zero, with nothing to say so                                     |
| `wavAudioBuffer(bytes)`             | The first, as the `AudioBuffer` an engine's loader is handed. **Throws on a malformed body**                                                                                                                       | whichever cases bind `decodeWavChannels` — kessler's `simple-2d` and orrery's two directly, volute's two through a wrapper naming its own `defaults`. `AudioHostOptions.decode` is REQUIRED for this reason: the cases split evenly, and there is no majority to default to                   |
| `silentAudioBuffer(bytes)`          | The second, as that buffer, `getChannelData` answering one shared silence of the right length. **Throws on a malformed body**                                                                                      | whichever cases bind `decodeWavHeader` — gantry's two through a wrapper naming `allowMissingData`                                                                                                                                                                                             |
| `tolerantAudioBuffer(bytes, opts?)` | Either of the two above, WHICH NEVER THROWS: a file it cannot parse comes back as one second of silence at `UNREADABLE_SAMPLE_RATE`, so a malformed produced file costs the point it belongs to and nothing else   | nobody yet. Facet's two engine projects hand `api.audio.load` a decode that cannot fail and keep their own, because theirs reads the body's LENGTH and inspects no header at all. See "Serving a build's produced files" for why the difference decides a whole project rather than one point |
| `WavDecodeOptions.allowMissingData` | A `.wav` with a header and no `data` chunk read as ZERO FRAMES rather than thrown on                                                                                                                               | gantry's `simple-3d`, which did; its `structured-3d` and the other two threw, and a zero-length buffer binds the cue and plays nothing, so the difference decides an item about a cue whose file carries no samples                                                                           |
| `TimedCue.looped`                   | Whether a firing STARTED A LOOP rather than played once                                                                                                                                                            | gantry's `structured-3d` carried it and its `simple-3d` did not, over one list holding both firings; the package's cue is a superset of both, so binding it adds a field neither suite reads and drops none                                                                                   |
| `inertAudioNode()`                  | A node that answers every member, memoized, both callable AND parameter-shaped                                                                                                                                     | gantry's `structured-3d`, as its own `audioNode`. Gantry's `simple-3d` `audioNode` minted a FRESH, NON-callable parameter per read, under which a value written to `node.gain` was invisible to the next read; this is a superset of both                                                     |
| `AssetRequest`                      | `{ url, offOrigin, status, file }` — a SUPERSET of gantry's `structured-3d` record, member for member, plus the file that answered                                                                                 | gantry's `structured-3d` exposes it as `assetRequests()`; orrery logs `string[]` and facet a `Transport.requests: string[]`, both of which `AssetHost.urls()` answers                                                                                                                         |
| —                                   | Gantry's `simple-3d` `assetRequests(): { path, found }[]` — the paths the build asked the SITE for, with no off-origin request in it at all — is a **different reading** built on the log, and stays with the case | gantry's `simple-3d`. `AssetHost` records what it handed to the platform's own `fetch` as well, which is a different question and one no point there asks                                                                                                                                     |

#### The evidence writers

| Package name            | What it is                                                                                            | Bound by                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `captureStill` (sync)   | A still off a 2D canvas, which is already rasterized, so `toBuffer` answers now                       | fifteen of the eighteen engine cases; a suite that calls it without an `await` is not asked to grow one |
| `captureOutput` (async) | The same writer for an encoder that cannot answer now — a 3D still that has to come out of a renderer | volute's `simple-2d`, orrery's two, gantry's `simple-3d`                                                |

Two more disagreements are recorded here as ones the package deliberately does
**not** resolve, because resolving them would be picking a winner:

- **`Harness.cues` subscribes `cue:played` alone by default.** A LOOP IS NOT A
  PLAY: a case whose specification counts firings would have every count moved by
  folding the two together, and a case whose specification is about a bed
  STARTING cannot read it without them. `EngineCaseConfig.cueEvents` is the case's
  to name, and `TimedCue.looped` tells the two apart afterwards.
- **`pointerPrecision`.** `"exact"` maps a logical point straight through the fit;
  `"device-pixel"` rounds to the pixel a reading would sample first. Half a pixel
  decides a point whenever a build's hit radius passes through it, so a case binds
  the one its verdicts were taken under — refract's two engine projects disagree
  here too, and always have.

## What has NOT been extracted yet

Stated so the next pass knows where the line is rather than rediscovering it.

- **The `OffscreenCanvas` stub.** Facet's `dom-shim.ts` stands one up beside its
  `document.createElement` shim, and it is the only case in the tree that does.
  `installAssetHost` supplies the document shim and not this one; a second case
  wanting it is the moment to add it, and until then adding it would be adding a
  member with one user and no second reading to check it against.

- **The `Transport`/`assetRequests` shapes a case builds ON the log.** The host
  answers `AssetRequest[]` and the URLs off it; what a case then exposes to its own
  suites — orrery's `Harness.assetRequests(): Promise<string[]>`, facet's
  per-harness `Transport { requests, basePath }`, wick's `assetsLoaded`/
  `assetFailures` off the engine's own events — stays with the case, because each
  is a different reading of a different question and only the LOG is shared.

- **Wick's `structured-2d` `FakeBuffer`**, which answers a decoded cue as
  `{ file, duration, sampleRate, numberOfChannels, length }` and carries **no
  `getChannelData` at all**. `silentAudioBuffer` is a superset of it except for
  the `file`, which is a fact about the case's own bookkeeping rather than about a
  decoded buffer.

- **The recorder's image interning** is extracted (`RecorderOptions.internImages`)
  and nothing binds it. Volute — the first of the two cases that intern to be
  migrated — checked its `ImageRef` field for field against `src/draw-calls.ts`
  and found the SEVEN FIELDS IDENTICAL AND TWO OF THEM FILLED DIFFERENTLY, so it
  keeps its own `imageRef` and its own `imageDraws` walk over it (see the
  collision table above). What is genuinely shared — where a decoded image came
  from — is `AssetHost.sourceOf`, and volute reads it from there. Orrery should
  make the same check rather than assuming either answer.
- **Gantry's `runUntil`** is not a sweep this kit can serve as it stands: it fails
  the test outright at its cap rather than answering `{ hit: false }`. That is a
  materially different contract and it belongs to gantry until a second case wants
  it. Its three migrated harnesses keep it under its own name — the engineless one
  over `Harness.until`, the two engine ones over their own tick loop, because a
  sweep that advanced through the kit would step past the frame boundaries their
  `screenOps()` is read at.

- **Shatter's two engine projects do not bind `createEngineCaseHarness` at all**,
  and they are the only ones in the tree that do not. They compose from the
  package's PARTS instead — the key event, the surface metrics, `readDebugSurface`
  and `absentSurface`, the driver, the device mapping and the pixel read, the
  colour, draw-call and placed-text readings, `breathe`, the evidence writers and
  the assertions — and keep the FRAME LOOP, the RECORDER and the CANVAS. The
  reason is measured, not stylistic: **a frame nobody looks at is not drawn and
  not recorded**. Rendering is ninety-six per cent of what a frame costs in that
  project — `0.16` ms against `0.006` ms for the simulation — so
  `saucer/at-most-one-at-a-time`'s two minutes of game time sampled every tick
  would rasterize and record roughly fourteen thousand four hundred pictures
  nothing reads, and `h.calls` would hold every one of those frames' operations
  where the suites are written against the last frame's alone. The kit's frame is
  one `engine.advance` per frame with the recorder always on, and the gate has to
  sit INSIDE the game's `render` and INSIDE the recording context — two seams the
  kit builds for itself and does not offer. Both harnesses' headers state this in
  full; read them before offering such a seam, because what would make them
  bindable is a gate on rasterizing and on recording, not another option on the
  kit. Shatter's `Harness.skip` and its stale-canvas refusal on `pixel`, `sample`
  and `captureStill` are the rest of that design.

- **Two seams `createRecordingCanvas` does not offer**, both reported by spectra:

  - **There is no way to interpose a clear UNDER the recorder.** Spectra's
    `covered-frames.ts` clears the backing store ahead of a fill it can prove
    covers it opaquely, which is what keeps a single `captureStill` from costing a
    minute of filtered re-rasterization — and that clear must reach the REAL
    context, beneath whatever records the build's calls, or it would appear in
    `h.calls` and in every captured replay and a check would read a clear the
    build never made. `createRecordingCanvas` builds the context and wraps it in
    one call, so there is nowhere between the two to stand. Spectra's `simple-2d`
    writes those three lines out over the package's own `recordingContext`; its
    `structured-2d` re-dresses the element the kit hands its engine factory.
  - **`RecorderOptions` records no transform at a `drawImage`** — see the footgun
    above. Spectra carries `transform` on its own `DrawCall` for the same reason
    wireworm stamps one, and the two solved it differently: spectra by writing its
    own recorder, wireworm by wrapping the log's `push`. Wireworm's is the one
    that needs no private copy of the recorder, and is the pattern to follow until
    the option exists.
