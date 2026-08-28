// brightness/from-eating — eating brightens the forager.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// Eating one plankton from G 0 raises brightness by BRIGHT_PER_EAT (0.34)
// within 0.01, and eating enough of them clamps G at exactly 1 rather than
// passing it.

import { it } from "vitest";

it("Eating brightens the forager", () => {
  throw new Error(
    "validation/none/brightness/from-eating.test.ts: not implemented",
  );
});
