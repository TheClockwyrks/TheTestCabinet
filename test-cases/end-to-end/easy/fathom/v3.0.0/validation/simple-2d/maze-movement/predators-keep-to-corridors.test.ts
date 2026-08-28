// maze-movement/predators-keep-to-corridors — predators keep to the corridors.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// The hunters' half of the same rule, asked in both shapes: chasing a fix
// across a rock spine a predator rounds the spine, standing on no rock tile at
// any moment of the crossing; and posed on a tile with no open neighbor it
// stays exactly where it is.

import { it } from "vitest";

it("Predators keep to the corridors", () => {
  throw new Error(
    "validation/simple-2d/maze-movement/predators-keep-to-corridors.test.ts: not implemented",
  );
});
