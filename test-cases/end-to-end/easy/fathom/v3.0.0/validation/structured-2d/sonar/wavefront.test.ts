// sonar/wavefront — the pulse travels as a wavefront.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A pulse's front advances at SONAR_WAVE_SPEED (14) corridor steps per second
// within 5 percent, standing 14 * t steps out t seconds after it was emitted,
// and the pulse leaves the list once its front passes its range rather than
// covering every tile at once.

import { it } from "vitest";

it("The pulse travels as a wavefront", () => {
  throw new Error(
    "validation/structured-2d/sonar/wavefront.test.ts: not implemented",
  );
});
