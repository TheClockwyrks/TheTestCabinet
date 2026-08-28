// ink/cloud — the cloud stands where it was released.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A released cloud has radius INK_RADIUS (80) within 1 unit and remaining
// INK_LIFE (3 s) within a tick, its center stays exactly where the forager
// released it while the forager swims away, remaining runs down with simulated
// time, and it leaves inkClouds when remaining reaches 0.

import { it } from "vitest";

it("The cloud stands where it was released", () => {
  throw new Error("validation/none/ink/cloud.test.ts: not implemented");
});
