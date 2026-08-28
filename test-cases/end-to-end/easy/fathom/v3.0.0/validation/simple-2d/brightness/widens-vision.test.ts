// brightness/widens-vision — brightness widens the light pocket.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// visionRadius is VISION_MIN + VISION_GAIN * G — 96 at G 0 and 160 at G 1,
// within 1 unit — read at several posed brightnesses, and a tile between the
// two radii is unlit at G 0 and lit at G 1.

import { it } from "vitest";

it("Brightness widens the light pocket", () => {
  throw new Error(
    "validation/simple-2d/brightness/widens-vision.test.ts: not implemented",
  );
});
