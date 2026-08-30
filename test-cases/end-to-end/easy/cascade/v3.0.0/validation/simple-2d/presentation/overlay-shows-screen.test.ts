// SCAFFOLD PLACEHOLDER — validation/simple-2d/presentation/overlay-shows-screen.test.ts
//
// The review item `presentation.overlay-shows-screen` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   The overlay reports the screen and mode
//
//   With the overlay toggled on over a posed board, the current screen and the deal mode are both on it.

import { it } from "vitest";

it("presentation.overlay-shows-screen — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/simple-2d/presentation/overlay-shows-screen.test.ts is a scaffold stub, not a validator",
  );
});
