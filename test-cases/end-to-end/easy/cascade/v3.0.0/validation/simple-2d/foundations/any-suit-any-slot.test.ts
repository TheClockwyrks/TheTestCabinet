// SCAFFOLD PLACEHOLDER — validation/simple-2d/foundations/any-suit-any-slot.test.ts
//
// The review item `foundations.any-suit-any-slot` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   Any suit may start any foundation
//
//   Each of the four Aces is accepted onto the fourth foundation in turn.

import { it } from "vitest";

it("foundations.any-suit-any-slot — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/simple-2d/foundations/any-suit-any-slot.test.ts is a scaffold stub, not a validator",
  );
});
