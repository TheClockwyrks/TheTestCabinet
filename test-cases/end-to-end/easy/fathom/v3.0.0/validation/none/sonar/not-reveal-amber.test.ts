// sonar/not-reveal-amber — it never resolves the amber look-alikes.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A bonus drifter and a Lanternjaw standing on flooded tiles beyond the
// forager's light are left as they were: the Lanternjaw reports lit false
// through the whole pulse, and the pixels at both creatures' motes are
// unchanged across the front's arrival within an RGB distance of 25 of 441.

import { it } from "vitest";

it("It never resolves the amber look-alikes", () => {
  throw new Error(
    "validation/none/sonar/not-reveal-amber.test.ts: not implemented",
  );
});
