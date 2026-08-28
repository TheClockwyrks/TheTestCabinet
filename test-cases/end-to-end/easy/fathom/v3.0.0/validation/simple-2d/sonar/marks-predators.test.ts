// sonar/marks-predators — it marks the Gloamfin and the Flarefish.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A Gloamfin and a Flarefish standing on a flooded tile beyond the forager's
// light report lit true from the moment the front reaches them and stay lit
// for SONAR_MARK_TIME (1.5 s) within a tenth of a second, then fall back to
// lit false.

import { it } from "vitest";

it("It marks the Gloamfin and the Flarefish", () => {
  throw new Error(
    "validation/simple-2d/sonar/marks-predators.test.ts: not implemented",
  );
});
