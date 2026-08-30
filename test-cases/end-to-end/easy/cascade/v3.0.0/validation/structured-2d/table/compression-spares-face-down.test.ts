// SCAFFOLD PLACEHOLDER — validation/structured-2d/table/compression-spares-face-down.test.ts
//
// The review item `table.compression-spares-face-down` declares this script in the case manifest, so
// the file has to exist for `cascade@v3.0.0` to resolve. The validator stage of
// the v3.0.0 rework replaces it with the real suite.
//
// It THROWS rather than passing, deliberately. A stub that quietly passed would
// score a build a point no validator had decided, and a stub the validator stage
// forgot would never be noticed.
//
// What this item must decide, from the manifest:
//
//   Compression leaves the face-down offset alone
//
//   A compressed column still draws 24 under each face-down card.

import { it } from "vitest";

it("table.compression-spares-face-down — the validator is not written yet", () => {
  throw new Error(
    "Cascade v3.0.0: validation/structured-2d/table/compression-spares-face-down.test.ts is a scaffold stub, not a validator",
  );
});
