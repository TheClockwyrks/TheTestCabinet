// SCAFFOLD PLACEHOLDER — validation/none/instrumentation/move-returns-verdict.test.ts
//
// The review item `instrumentation.move-returns-verdict` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   move reports what the rules decided
//
//   A legal move returns true and applies; an illegal one returns false and leaves the board exactly as it was.

import { it } from "vitest";

it("instrumentation.move-returns-verdict — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/instrumentation/move-returns-verdict.test.ts is a scaffold stub, not a validator",
  );
});
