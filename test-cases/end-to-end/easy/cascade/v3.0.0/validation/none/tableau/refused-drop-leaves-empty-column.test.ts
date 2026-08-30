// SCAFFOLD PLACEHOLDER — validation/none/tableau/refused-drop-leaves-empty-column.test.ts
//
// The review item `tableau.refused-drop-leaves-empty-column` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A refused drop leaves an empty column empty
//
//   A non-King released with its centre inside an empty column's drop rectangle, as specs/table.md fixes it, is refused; the column still holds nothing and the source is intact.

import { it } from "vitest";

it("tableau.refused-drop-leaves-empty-column — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/tableau/refused-drop-leaves-empty-column.test.ts is a scaffold stub, not a validator",
  );
});
