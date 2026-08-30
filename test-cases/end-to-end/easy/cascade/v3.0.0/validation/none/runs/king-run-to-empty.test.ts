// SCAFFOLD PLACEHOLDER — validation/none/runs/king-run-to-empty.test.ts
//
// The review item `runs.king-run-to-empty` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   A King-headed run fills an empty column
//
//   A run led by a King is accepted onto an empty column.

import { it } from "vitest";

it("runs.king-run-to-empty — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/runs/king-run-to-empty.test.ts is a scaffold stub, not a validator",
  );
});
