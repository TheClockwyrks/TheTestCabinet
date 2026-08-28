// presentation/provided-art — the seeded sheets are what the game draws from.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// Over a live dive drawing the forager, a maze of rock and corridor, all three
// predators, a drifter and a flare, every one of the seven seeded sheets is
// loaded and drawn: each element is drawn from an image source that is a frame
// of its own sheet, at the frame sizes specs/assets.md gives, rather than from
// shapes drawn in code or from art of the build's own.

import { it } from "vitest";

it("The seeded sheets are what the game draws from", () => {
  throw new Error(
    "validation/none/presentation/provided-art.test.ts: not implemented",
  );
});
