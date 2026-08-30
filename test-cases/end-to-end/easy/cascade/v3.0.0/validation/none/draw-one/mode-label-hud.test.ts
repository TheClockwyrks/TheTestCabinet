// SCAFFOLD PLACEHOLDER — validation/none/draw-one/mode-label-hud.test.ts
//
// The review item `draw-one.mode-label-hud` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   The HUD's label reads DRAW ONE
//
//   The HUD draws the literal DRAW ONE during play.

import { it } from "vitest";

it("draw-one.mode-label-hud — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/draw-one/mode-label-hud.test.ts is a scaffold stub, not a validator",
  );
});
