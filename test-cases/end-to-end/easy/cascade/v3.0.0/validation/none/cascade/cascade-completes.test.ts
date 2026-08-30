// SCAFFOLD PLACEHOLDER — validation/none/cascade/cascade-completes.test.ts
//
// The review item `cascade.cascade-completes` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   Every card launches and retires
//
//   With the cascade run out, launched is 52, no flyer remains, and cascadeDone is true.

import { it } from "vitest";

it("cascade.cascade-completes — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/cascade/cascade-completes.test.ts is a scaffold stub, not a validator",
  );
});
