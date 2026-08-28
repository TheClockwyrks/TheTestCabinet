// den/stagger — predators are released 5 s apart, in order.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// From the moment screen becomes playing, the first predator's released turns
// true at 0 s and each one after it DEN_RELEASE_GAP (5 s) later, within a
// tenth of a second, in the DEN_ORDER the snapshot lists them in — Lanternjaw,
// then Gloamfin, then Flarefish — and no predator is released during the
// countdown that precedes play.

import { it } from "vitest";

it("Predators are released 5 s apart, in order", () => {
  throw new Error(
    "validation/structured-2d/den/stagger.test.ts: not implemented",
  );
});
