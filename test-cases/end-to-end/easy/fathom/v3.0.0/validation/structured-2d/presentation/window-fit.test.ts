// presentation/window-fit — the stage is fitted and centered.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// Over surfaces wider than the stage, taller than it, and at a raised device
// pixel ratio, the whole STAGE_W x STAGE_H (1280 x 720) stage is inside the
// surface at its own aspect ratio, centered with even letterboxing, and the
// bars carry the stage's background color within an RGB distance of 25 of 441.

import { it } from "vitest";

it("The stage is fitted and centered", () => {
  throw new Error(
    "validation/structured-2d/presentation/window-fit.test.ts: not implemented",
  );
});
