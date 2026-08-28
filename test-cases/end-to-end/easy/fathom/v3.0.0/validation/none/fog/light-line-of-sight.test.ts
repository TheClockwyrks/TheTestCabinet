// fog/light-line-of-sight — the light does not bend around corners.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A predator whose center is within V of the forager's but whose joining
// segment crosses a rock tile reports lit false, and the same predator reports
// lit true once the forager rounds the corner with nothing but open water
// between them.

import { it } from "vitest";

it("The light does not bend around corners", () => {
  throw new Error(
    "validation/none/fog/light-line-of-sight.test.ts: not implemented",
  );
});
