// sonar/reveals-walls — it floods the corridors and reveals the rock bounding them.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// Every open tile within E corridor steps of the origin becomes revealed,
// following the corridors around a corner and through a junction, together
// with the rock tiles bounding those corridors — while a corridor tile beyond
// E, and a pocket rock seals off, both stay u.

import { it } from "vitest";

it("It floods the corridors and reveals the rock bounding them", () => {
  throw new Error(
    "validation/none/sonar/reveals-walls.test.ts: not implemented",
  );
});
