// SCAFFOLD PLACEHOLDER — validation/structured-2d/handling/slow-second-press-does-not.test.ts
//
// The review item `handling.slow-second-press-does-not` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A slow second press does not auto-move
//
//   Two presses 0.4 s apart, past DOUBLE_CLICK_WINDOW (0.30), leave the card where it was.

import { it } from "vitest";

it("handling.slow-second-press-does-not — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/handling/slow-second-press-does-not.test.ts is a scaffold stub, not a validator",
  );
});
