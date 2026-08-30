// SCAFFOLD PLACEHOLDER — validation/simple-2d/automove/illegal-does-nothing.test.ts
//
// The review item `automove.illegal-does-nothing` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   An illegal auto-move changes nothing
//
//   With no foundation able to accept the card, the board is unchanged and the call returns false.

import { it } from "vitest";

it("automove.illegal-does-nothing — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/simple-2d/automove/illegal-does-nothing.test.ts is a scaffold stub, not a validator",
  );
});
