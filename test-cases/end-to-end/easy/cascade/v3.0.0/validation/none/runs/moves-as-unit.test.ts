// SCAFFOLD PLACEHOLDER — validation/none/runs/moves-as-unit.test.ts
//
// The review item `runs.moves-as-unit` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A valid run moves as a unit
//
//   A three-card descending-alternating run moves together onto a legal column.

import { it } from "vitest";

it("runs.moves-as-unit — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/runs/moves-as-unit.test.ts is a scaffold stub, not a validator",
  );
});
