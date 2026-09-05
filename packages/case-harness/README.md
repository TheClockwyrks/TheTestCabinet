# `@clockwyrks/case-harness`

The shared engineless (`none`) validation harness a test case's validator project
is built on: the browser lifecycle, the driven-frame loop, the injected
draw-command recorder and audio probe, and the readings a check makes over them.

## What this is

Every case that supports the `none` engine validates a produced build the same
way — serve the built site, hold one Chromium, drive the build one frame at a
time through the debug surface `specs/instrumentation.md` told it to install, and
read what it drew. That machinery is the case's _harness_, and it used to be
copied whole into each case's `validation/none/` directory. This package is the
one copy.

What stays with the case is what is genuinely the case's: its handle
(`window.__refract`), the operations its specification requires, its snapshot and
debug-surface types, its stage size and tick rate, and every helper that reads
its own game. Those arrive here as **types by generics** and **values by config** —
one `CaseConfig` object, threaded through one factory.

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

## How a case wires it up

Four files in a case's `validation/<engine>/` directory, and nothing else
changes — every suite goes on importing `../harness` and `../assert`, which
become thin re-exports.

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

## Names that collided, and what each case binds

Four copies of this machinery drifted for as long as they existed, and the drift
that matters is not the code — it is the **names**. Six readings were spelled the
same way in two cases and meant different things, and a seventh was spelled two
ways and meant one thing. Folding either kind together silently rescales a
threshold or drops a call site, and nothing type-checks a case's validator tree
before it runs, so neither failure has anywhere to surface.

So both halves of every genuine disagreement ship, under names that say which is
which, and a case binds the one it has always meant. The rule this follows is the
one `speedOverTicks`/`gainOverTicks` already set: **never silently pick a
winner.**

| Package name                                   | What it is                                                                                                                                                                        | Bound by                                                                   |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `luminance(c)`                                 | Rec. 709 weighted, `0.2126r + 0.7152g + 0.0722b`                                                                                                                                  | refract, carom, volute (volute re-exports it; `luminanceMask` ranks by it) |
| `meanChannel(c)`                               | The unweighted mean, `(r + g + b) / 3`                                                                                                                                            | fathom, as its own `luminance`                                             |
| `meanColor(rect, keep?)`                       | The mean over a **rectangle**, skipping what `keep` rejects                                                                                                                       | volute                                                                     |
| `meanOf(pixels)`                               | The mean over a run of sampled **points**                                                                                                                                         | fathom, as its own `meanColor`                                             |
| `drawnText(calls)`                             | The RAW `fillText`/`strokeText` strings, as a `string[]`                                                                                                                          | refract, carom, volute; fathom as its own `textRuns`                       |
| `drawnTextLines(calls)`                        | The LOGICAL runs those calls spell, as a `string[]` — a letter-spaced heading is one entry                                                                                        | refract; `drewText` reads copy off this                                    |
| `drawnTextRuns(calls)`                         | The same runs placed, as `TextDraw[]`; `textDraws` stays one entry per call                                                                                                       | refract                                                                    |
| —                                              | Fathom's `drawnText(ops)` — the runs upper-cased and joined into one string — is a **different function**, and stays in fathom's `states/screens.ts`                              | fathom                                                                     |
| `sampleColor(h, x, y, radius?)`                | The mean of a five-point cluster, `radius` out on the axes                                                                                                                        | refract, carom (both at the default `4`)                                   |
| `sampleDisc(h, x, y, radius)`                  | The mean over a disc; **the radius is required**                                                                                                                                  | volute, which supplies its own `CORE_RADIUS - 1`                           |
| `darkestOf(h, points, radius?)`                | The darkest of several sampled patches: the bare ground                                                                                                                           | refract as `sampleBench`, carom as `sampleField`                           |
| `brightestIn(samples, score, keep?)`           | The brightest of a neighbourhood; **`score` is required**, because the two luminances above pick different pixels                                                                 | fathom                                                                     |
| `mousePress` / `mouseGlide` / `mouseRelease`   | A real mouse gesture mapped through `Harness.css`, one driven frame each                                                                                                          | refract                                                                    |
| `Harness.movePointer` / `Harness.clickPointer` | The harness's own pair, mapped through `Harness.cssPoint` — unrounded, for the case that measures the fit itself                                                                  | volute                                                                     |
| `Harness.arrange(calls)`                       | A batch of surface calls run in ONE crossing, typed against the case's own surface as `[op, ...args]`, answering the SNAPSHOT they left                                           | spectra, as its own `pose`                                                 |
| —                                              | Cascade's `Harness.pose(calls)` — `{ op, args }` objects, answering what each call RETURNED — is a **different function**, and stays in cascade's own `harness.ts`                | cascade                                                                    |
| `Harness.samples(frames, …)`                   | A reading per frame, taken IN THE PAGE by a `project` carried in as source, in one crossing                                                                                       | spectra                                                                    |
| —                                              | Cascade's `Harness.sample(frames)` — the shared `stepWatching` under cascade's own name, one round trip per frame — is a **near neighbour of that name and not the same reading** | cascade                                                                    |
