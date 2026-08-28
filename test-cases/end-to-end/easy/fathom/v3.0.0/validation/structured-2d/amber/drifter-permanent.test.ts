// amber/drifter-permanent — a drifter stays until it is eaten.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A spawned drifter is still in drifters after a stretch far longer than
// DRIFTER_INTERVAL (25 s), holding its pace at DRIFTER_SPEED (64) within 2
// percent throughout, and it leaves the list only when the forager eats it.

import { it } from "vitest";

it("A drifter stays until it is eaten", () => {
  throw new Error(
    "validation/structured-2d/amber/drifter-permanent.test.ts: not implemented",
  );
});
