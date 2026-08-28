// flarefish/flare-cadence — it flares on the interval, charge then bloom.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A wandering Flarefish out of reach of the forager runs flareCharging true
// for FLARE_CHARGE (0.5 s) then flaring true for FLARE_BLOOM (1 s), each
// within a tenth of a second, and consecutive charge-ups begin FLARE_INTERVAL
// (7 s) after the previous bloom ended, so they are 8.5 s apart within a fifth
// of a second.

import { it } from "vitest";

it("It flares on the interval, charge then bloom", () => {
  throw new Error(
    "validation/structured-2d/flarefish/flare-cadence.test.ts: not implemented",
  );
});
