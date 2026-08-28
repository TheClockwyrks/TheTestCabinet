// controls/pause-p — keyP pauses live play.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// Pressing KeyP while screen is playing sets screen to paused, exactly as
// Escape does.

import { it } from "vitest";

it("KeyP pauses live play", () => {
  throw new Error(
    "validation/structured-2d/controls/pause-p.test.ts: not implemented",
  );
});
