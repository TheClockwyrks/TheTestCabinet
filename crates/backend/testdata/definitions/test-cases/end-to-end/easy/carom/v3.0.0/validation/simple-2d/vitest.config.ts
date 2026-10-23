// Carom — the vitest project the CASE's validators run as. CASE-PROVIDED.
//
// The whole of it is the shared `@clockwyrks/case-harness` package's factory,
// which fixes everything that makes a staged validator project one shape the
// runner can drive — the project's name, the suites it collects, the `node`
// environment, and the refusal to pass a run that collected nothing — and leaves
// this file the three values that are genuinely Carom's.
//
//   npx vitest run                                       # the build's own tests
//   npx vitest run --config validation/vitest.config.ts  # the case's validators
//
// The factory is imported by its own specifier rather than through the package's
// barrel, because it is loaded by vite's own config path before the test runtime
// exists and it is the file whose failure mode is "the project would not load at
// all".
import { defineEngineValidationConfig } from "./case-harness/engine/vitest-config";

export default defineEngineValidationConfig({
  // The workspace, not this directory, so a validator resolves the build's
  // modules by the same relative paths the build itself uses. Derived from this
  // file's own URL rather than from the working directory, so the command above
  // works from anywhere.
  root: new URL("..", import.meta.url).pathname,
  // Every frame this project advances is a frame the runtime RENDERS, so a check
  // that plays a rally to the speed ceiling costs thousands of real renders, and
  // how long those take is a property of the machine rather than of the build. So
  // the ceiling below is not what the checks cost — it is set several times above
  // the slowest a correct build has been measured at on a machine loaded far past
  // anything a run should meet, because a timeout that fails a correct build is a
  // defect in the check rather than a fact about the build.
  testTimeout: 300_000,
  // A harness is built in a `beforeEach`, so a hook that expires fails the check
  // just as a timeout does — and this project's hook constructs a runtime and
  // awaits the game's `initialize`. The factory's own 120 s is already far above
  // vitest's 10 s default; this case measured its hooks under the same load its
  // checks were measured under and holds them to the same allowance.
  hookTimeout: 300_000,
  // Capped rather than left to the pool's reading of the machine, for the same
  // reason the engineless project caps it: the host running this is running a
  // model's build under it, and a project that fans out across every core
  // contends with itself, so each suite takes several times longer than it does
  // alone.
  maxWorkers: 4,
});
