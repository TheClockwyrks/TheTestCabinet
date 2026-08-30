// SCAFFOLD PLACEHOLDER — validation/structured-2d/runs/onto-legal-card.test.ts
//
// The review item `runs.onto-legal-card` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A run lands on a legal card
//
//   A run whose leading card is one lower and opposite in color to the target's lowest card is accepted.

import { it } from "vitest";

it("runs.onto-legal-card — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/runs/onto-legal-card.test.ts is a scaffold stub, not a validator",
  );
});
