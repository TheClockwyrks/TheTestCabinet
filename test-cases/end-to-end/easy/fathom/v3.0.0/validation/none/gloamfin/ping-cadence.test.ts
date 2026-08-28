// gloamfin/ping-cadence — it pings on its own cadence.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A wandering Gloamfin out of hearing range of the forager casts a violet ping
// from its own tile, with source gloamfin and tint violet, and consecutive
// pings arrive GLOAMFIN_PING_INTERVAL (4 s) apart within a tenth of a second,
// over at least three of them.

import { it } from "vitest";

it("It pings on its own cadence", () => {
  throw new Error(
    "validation/none/gloamfin/ping-cadence.test.ts: not implemented",
  );
});
