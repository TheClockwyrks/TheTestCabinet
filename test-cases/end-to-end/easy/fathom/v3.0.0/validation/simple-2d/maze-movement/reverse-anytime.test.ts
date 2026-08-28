// maze-movement/reverse-anytime — reversal is allowed anywhere.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// The opposite direction held mid-tile reverses the forager on the tick it is
// read, away from any tile center: dir flips and the position starts back the
// way it came, without waiting for a center.

import { it } from "vitest";

it("Reversal is allowed anywhere", () => {
  throw new Error(
    "validation/simple-2d/maze-movement/reverse-anytime.test.ts: not implemented",
  );
});
