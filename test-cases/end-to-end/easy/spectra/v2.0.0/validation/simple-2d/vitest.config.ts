// Spectra — the vitest project the CASE's validators run as. CASE-PROVIDED.
//
// The whole of it is the shared `@clockwyrks/case-harness` package's factory, which
// fixes everything that makes a staged validator project one shape the runner can
// drive — the project's name, the suites it collects, the `node` environment, and
// the refusal to pass a run that collected nothing — and leaves this file the four
// values that are genuinely Spectra's.
//
//   npx vitest run                                       # the build's own tests
//   npx vitest run --config validation/vitest.config.ts  # the case's validators
//
// The two never mix: the build's config names `src/**/*.test.ts` and measures
// coverage over `src/`, so the tests a build wrote are counted and covered on their
// own, and the verdict rests on the suites in this directory alone. A build cannot
// reach the verdict by writing a test, and a case's validator cannot flatter the
// build's coverage.
//
// The factory is imported by its own specifier rather than through the package's
// barrel, because it is loaded by vite's own config path before the test runtime
// exists and it is the file whose failure mode is "the project would not load at
// all".
import { defineEngineValidationConfig } from "./case-harness/engine/vitest-config";

export default defineEngineValidationConfig({
  // The workspace, not this directory, so a validator addresses the build by the
  // same relative path the build itself uses, and reads the seeded art off the
  // workspace's own `assets/` tree. Derived from this file's own URL rather than
  // from the working directory, so the command above works from anywhere.
  root: new URL("..", import.meta.url).pathname,
  // Every scenario is posed and stepped in process, so a suite costs milliseconds
  // on a quiet host, and the longest suite in either engine project — one that
  // builds a whole wave and plays it out rather than posing its way to the frame it
  // reads — measures a handful of seconds of them.
  //
  // The ceiling is not a figure any check is sized against: what it bounds is a
  // suite that never returns. It stands a hundred times over that longest reading,
  // because a check cut short by the runner reports a build's failure that never
  // happened. Ten minutes rather than the factory's five for the room, which costs
  // nothing: the whole project finishes in well under a minute, so this ceiling is
  // reached only by a suite that has genuinely stopped.
  testTimeout: 600_000,
  // The harness builds an engine and loads the seeded art in a `beforeEach`, so the
  // hook gets the same ceiling the suite does rather than the factory's two
  // minutes.
  hookTimeout: 600_000,
  // Every frame a suite advances is a frame the engine renders into an
  // `@napi-rs/canvas` surface, so these projects are CPU rather than round trips,
  // and left to itself vitest fans out over every core the box has. Capped so the
  // project does not contend with itself on a host that is already running
  // everything else.
  //
  // EIGHT IS FREE HERE, WHICH IT IS NOT FOR THE ENGINELESS PROJECT. There is no
  // globalSetup and no shared browser: a worker is its own process rendering into
  // its own surface. Measured over this whole project on an idle host, four workers
  // and eight give the SAME per-suite durations to within noise while the wall clock
  // halves — so unlike `validation/none`, raising the count buys throughput without
  // spending any of the headroom the per-test ceiling above is there to provide.
  maxWorkers: 8,
});
