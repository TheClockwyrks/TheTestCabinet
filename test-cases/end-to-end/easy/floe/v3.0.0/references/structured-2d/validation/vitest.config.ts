// Floe — the vitest project the CASE's validators run as. CASE-PROVIDED.
//
// The whole of it is the shared `@clockwyrks/case-harness` package's factory,
// which fixes everything that makes a staged validator project one shape the
// runner can drive — the project's name, the suites it collects, the `node`
// environment, and the refusal to pass a run that collected nothing — and leaves
// this file the three values that are genuinely Floe's on this engine.
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
  // The workspace, not this directory, so a validator addresses the build by the
  // same relative paths the build itself uses. Derived from this file's own URL
  // rather than from the working directory, so the command above works from
  // anywhere.
  root: new URL("..", import.meta.url).pathname,
  // A CEILING ON HOW MANY OF THESE RUN AT ONCE, because every one of them is
  // CPU. The engine advances and draws each frame in this process, so a suite is
  // compute rather than a wait — left to fan out across every core, the project
  // contends with ITSELF and the same suites take several times as long as they
  // do in isolation. What the ceiling bounds here is CORES, not the pages the
  // engineless project's workers bound, which is why this figure does not follow
  // that one: four leaves a two-core host room for the work under it rather than
  // oversubscribing it.
  maxWorkers: 4,
  // A CEILING FOR A HUNG SUITE, NOT AN ALLOWANCE FOR A SLOW ONE. Every
  // measurement in this project is taken in the game's own ticks and decides the
  // same thing however long the host took to run them; the only thing this figure
  // can decide is whether a BUSY MACHINE fails a build that is right. The suites
  // here are seconds of work — measured on a twenty-core host under a load
  // average of four hundred and sixty, the slowest of them was under a minute —
  // so five minutes is several times over the worst a loaded host has been seen
  // to produce, and it costs a conforming build nothing.
  testTimeout: 300_000,
  // The same figure for the hooks, which is where the harness is built, and this
  // case's own measurement rather than the factory's two minutes: building a
  // harness on a loaded host has been measured well past vitest's ten-second
  // default, and a hook that expires reports the check as broken rather than
  // reporting anything about the build.
  hookTimeout: 300_000,
});
