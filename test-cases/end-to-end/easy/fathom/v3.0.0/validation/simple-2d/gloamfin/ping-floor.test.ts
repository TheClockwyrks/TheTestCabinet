// gloamfin/ping-floor — no two pings closer than the floor.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// Across a stretch covering an ordinary cadence and a search's guaranteed
// ping, no two pings a Gloamfin casts arrive closer than GLOAMFIN_PING_MIN_GAP
// (3 s) apart, the guaranteed one waiting for the floor rather than breaking
// it.

import { it } from "vitest";

it("No two pings closer than the floor", () => {
  throw new Error(
    "validation/simple-2d/gloamfin/ping-floor.test.ts: not implemented",
  );
});
