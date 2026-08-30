// SCAFFOLD PLACEHOLDER — validation/structured-2d/draw-three/mode-label-title.test.ts
//
// The review item `draw-three.mode-label-title` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   The title screen's label reads DRAW THREE
//
//   The title screen draws the literal DRAW THREE, this variant's DEAL_MODE_LABEL.

import { it } from "vitest";

it("draw-three.mode-label-title — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/draw-three/mode-label-title.test.ts is a scaffold stub, not a validator",
  );
});
