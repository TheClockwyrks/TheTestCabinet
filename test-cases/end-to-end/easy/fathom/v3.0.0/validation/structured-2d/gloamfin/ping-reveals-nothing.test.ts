// gloamfin/ping-reveals-nothing — its ping reveals nothing.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A ping sweeping over unrevealed corridor leaves every tile it passes
// reporting u, marks no predator and no drifter — every lit flag unchanged,
// the casting Gloamfin's included — and the pixels at a tile it swept, sampled
// once the front has passed, are unchanged from before the ping within an RGB
// distance of 25 of 441.

import { it } from "vitest";

it("Its ping reveals nothing", () => {
  throw new Error(
    "validation/structured-2d/gloamfin/ping-reveals-nothing.test.ts: not implemented",
  );
});
