// kindle/predators-by-light — predators are drawn by the light, not the circle.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A predator posed inside windowRadius but beyond visionRadius reports lit
// false and draws no body, and the same predator brought inside visionRadius
// with clear line of sight reports lit true, so the circle governs the maze
// and the light pocket governs the hunters.

import { it } from "vitest";

it("Predators are drawn by the light, not the circle", () => {
  throw new Error(
    "validation/simple-2d/kindle/predators-by-light.test.ts: not implemented",
  );
});
