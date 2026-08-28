// kindle/grows-with-eating — the circle grows as you eat.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// windowRadius is KINDLE_VISION_MIN + KINDLE_VISION_GAIN * G — 192 at G 0 and
// 320 at G 1, within 1 unit — read at several posed brightnesses, and it is
// larger than visionRadius at every one of them.

import { it } from "vitest";

it("The circle grows as you eat", () => {
  throw new Error(
    "validation/none/kindle/grows-with-eating.test.ts: not implemented",
  );
});
