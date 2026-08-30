// Meltdown — instrumentation/surface-present: the debug surface is present and
// complete.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Every operation specs/instrumentation.md names is a function on the
//   surface, version is MELTDOWN_DEBUG_VERSION (1), and the surface is live: a
//   posed tower reads back, a posed unit walks, and the canvas changes.

import { it } from "vitest";

it("The debug surface is present and complete", () => {
  throw new Error(
    "Meltdown: validation/instrumentation/surface-present.test.ts is not implemented yet",
  );
});
