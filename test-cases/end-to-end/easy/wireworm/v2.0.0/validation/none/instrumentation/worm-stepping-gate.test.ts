// Wireworm — instrumentation.worm-stepping-gate, under the `none` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// Stepping off holds a worm still
//
// A worm with setWormStepping(id, false) takes no tile step over ten step
// intervals, while a second worm with stepping on steps ten times.

import { test } from "vitest";

test("instrumentation.worm-stepping-gate", () => {
  throw new Error(
    "wireworm v2.0.0: validation/none/instrumentation/worm-stepping-gate.test.ts has not been written yet",
  );
});
