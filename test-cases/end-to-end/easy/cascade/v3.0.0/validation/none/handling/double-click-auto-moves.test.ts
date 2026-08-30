// SCAFFOLD PLACEHOLDER — validation/none/handling/double-click-auto-moves.test.ts
//
// The review item `handling.double-click-auto-moves` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   Two quick presses send a card home
//
//   Two presses 0.1 s apart at the same point send the card to its foundation.

import { it } from "vitest";

it("handling.double-click-auto-moves — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/handling/double-click-auto-moves.test.ts is a scaffold stub, not a validator",
  );
});
