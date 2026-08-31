# `@test-cabinet/case-harness`

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
  in `test/` — outside `package.json`'s `files` — and is named `*.spec.ts`.

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

| Package name                                   | What it is                                                                                                                                           | Bound by                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `luminance(c)`                                 | Rec. 709 weighted, `0.2126r + 0.7152g + 0.0722b`                                                                                                     | refract, carom, volute (volute re-exports it; `luminanceMask` ranks by it) |
| `meanChannel(c)`                               | The unweighted mean, `(r + g + b) / 3`                                                                                                               | fathom, as its own `luminance`                                             |
| `meanColor(rect, keep?)`                       | The mean over a **rectangle**, skipping what `keep` rejects                                                                                          | volute                                                                     |
| `meanOf(pixels)`                               | The mean over a run of sampled **points**                                                                                                            | fathom, as its own `meanColor`                                             |
| `drawnText(calls)`                             | The runs a frame drew, as a `string[]`                                                                                                               | refract, carom, volute; fathom as its own `textRuns`                       |
| —                                              | Fathom's `drawnText(ops)` — the runs upper-cased and joined into one string — is a **different function**, and stays in fathom's `states/screens.ts` | fathom                                                                     |
| `sampleColor(h, x, y, radius?)`                | The mean of a five-point cluster, `radius` out on the axes                                                                                           | refract, carom (both at the default `4`)                                   |
| `sampleDisc(h, x, y, radius)`                  | The mean over a disc; **the radius is required**                                                                                                     | volute, which supplies its own `CORE_RADIUS - 1`                           |
| `darkestOf(h, points, radius?)`                | The darkest of several sampled patches: the bare ground                                                                                              | refract as `sampleBench`, carom as `sampleField`                           |
| `brightestIn(samples, score, keep?)`           | The brightest of a neighbourhood; **`score` is required**, because the two luminances above pick different pixels                                    | fathom                                                                     |
| `mousePress` / `mouseGlide` / `mouseRelease`   | A real mouse gesture mapped through `Harness.css`, one driven frame each                                                                             | refract                                                                    |
| `Harness.movePointer` / `Harness.clickPointer` | The harness's own pair, mapped through `Harness.cssPoint` — unrounded, for the case that measures the fit itself                                     | volute                                                                     |
