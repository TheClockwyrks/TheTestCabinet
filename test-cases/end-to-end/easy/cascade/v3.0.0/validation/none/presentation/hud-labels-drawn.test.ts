// SCAFFOLD PLACEHOLDER — validation/none/presentation/hud-labels-drawn.test.ts
//
// The review item `presentation.hud-labels-drawn` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   Each HUD control draws its label
//
//   Each of the three labels is drawn inside its own rectangle.

import { it } from "vitest";

it("presentation.hud-labels-drawn — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/presentation/hud-labels-drawn.test.ts is a scaffold stub, not a validator",
  );
});
