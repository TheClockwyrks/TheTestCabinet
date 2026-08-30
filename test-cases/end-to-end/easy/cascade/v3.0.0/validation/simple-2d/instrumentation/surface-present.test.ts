// SCAFFOLD PLACEHOLDER — validation/simple-2d/instrumentation/surface-present.test.ts
//
// The review item `instrumentation.surface-present` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   The debug surface is present and complete
//
//   Every operation specs/instrumentation.md names is a function on the surface, version is CASCADE_DEBUG_VERSION (1), and the surface is live: a posed card reads back and a posed move applies.

import { it } from "vitest";

it("instrumentation.surface-present — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/simple-2d/instrumentation/surface-present.test.ts is a scaffold stub, not a validator",
  );
});
