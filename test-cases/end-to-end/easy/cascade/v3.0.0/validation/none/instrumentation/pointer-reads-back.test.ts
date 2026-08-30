// SCAFFOLD PLACEHOLDER — validation/none/instrumentation/pointer-reads-back.test.ts
//
// The review item `instrumentation.pointer-reads-back` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   The pointer is reported
//
//   pointerDown, pointerMove and pointerUp are each reported by snapshot().pointer, and a press is reported by lastPress.

import { it } from "vitest";

it("instrumentation.pointer-reads-back — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/none/instrumentation/pointer-reads-back.test.ts is a scaffold stub, not a validator",
  );
});
