// flarefish/flare-lock — the bloom locks on through rock.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A forager anywhere within FLARE_RADIUS (192) of a blooming Flarefish at any
// step of the bloom is locked onto through rock: state becomes chase, alert
// becomes true, and flaring falls to false on that step, the bloom ending at
// once. A forager posed just beyond the radius is not locked onto.

import { it } from "vitest";

it("The bloom locks on through rock", () => {
  throw new Error(
    "validation/none/flarefish/flare-lock.test.ts: not implemented",
  );
});
