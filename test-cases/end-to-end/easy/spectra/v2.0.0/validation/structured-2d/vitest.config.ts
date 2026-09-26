// Spectra — the vitest project the CASE's validators run as. CASE-PROVIDED.
//
// The whole of it is the shared `@clockwyrks/case-harness` package's factory,
// which fixes everything that makes a staged validator project one shape the
// runner can drive — the project's name, the suites it collects, the `node`
// environment, and the refusal to pass a run that collected nothing — and leaves
// this file the values that are genuinely Spectra's. The two projects never mix:
// the build's own `vitest.config.ts` at the workspace root names
// `src/**/*.test.ts` and measures coverage over `src/`, so a build cannot reach
// the verdict by writing a test and a case's check cannot flatter the build's
// coverage.
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
  // modules by the same relative paths the build itself uses and reads the
  // seeded art off the workspace's own `assets/` tree. Derived from this file's
  // own URL rather than from the working directory, so the command above works
  // from anywhere.
  root: new URL("..", import.meta.url).pathname,
  // TEN MINUTES RATHER THAN THE FACTORY'S FIVE, and the measurement is this
  // project's own: every scenario is posed and stepped in process, so a suite
  // costs milliseconds on a quiet host, and the longest suite here — one that
  // builds a whole wave and plays it out rather than posing its way to the frame
  // it reads — measures a handful of seconds. The ceiling stands a hundred times
  // over that longest reading, and the room costs nothing, because the whole
  // project finishes in well under a minute: this allowance is reached only by a
  // suite that has genuinely stopped.
  testTimeout: 600_000,
  // The same ceiling on the hooks, because every suite builds its harness in a
  // `beforeEach` and this case's `initialize` decodes four seeded PNGs and a
  // particle system inside the level's `load`: a build whose loading is slow must
  // fail on its own merits rather than on a hook the runner cut short.
  hookTimeout: 600_000,
  // EIGHT IS FREE HERE, WHICH IT IS NOT FOR THE ENGINELESS PROJECT. There is no
  // globalSetup and no shared browser: a worker is its own process rendering into
  // its own `@napi-rs/canvas` surface. Measured over this whole project on an
  // idle host, four workers and eight give the SAME per-suite durations to within
  // noise while the wall clock halves — so unlike `validation/none`, raising the
  // count buys throughput without spending any of the headroom the per-test
  // ceiling above is there to provide. Capped rather than left to vitest's own
  // fan-out so the project does not contend with itself on a host that is already
  // running everything else.
  maxWorkers: 8,
});
