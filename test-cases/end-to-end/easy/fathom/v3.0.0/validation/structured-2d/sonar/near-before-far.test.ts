// sonar/near-before-far — it reveals near tiles before far ones.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// On a posed corridor running straight out from the forager, a tile 2 corridor
// steps out is revealed strictly before a tile 7 steps out, and each becomes
// revealed within 5 percent of its own distance divided by SONAR_WAVE_SPEED.

import { it } from "vitest";

it("It reveals near tiles before far ones", () => {
  throw new Error(
    "validation/structured-2d/sonar/near-before-far.test.ts: not implemented",
  );
});
