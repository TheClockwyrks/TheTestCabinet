// Wireworm — instrumentation.deterministic-core, under the `simple-2d` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// The simulation advances on elapsed time alone
//
// One second of game time covered as one frame and as sixty frames adds 1.0 to
// simTime either way and leaves the worm on the same tile, so the simulation
// reads nothing from the renderer.

import { test } from "vitest";

test("instrumentation.deterministic-core", () => {
  throw new Error(
    "wireworm v2.0.0: validation/simple-2d/instrumentation/deterministic-core.test.ts has not been written yet",
  );
});
