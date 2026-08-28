// controls/mute — keyM toggles mute.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// Pressing KeyM flips muted, and while muted is true an event that raises a
// cue — the forager emitting a sonar pulse — sounds nothing, while the same
// event with muted false sounds its cue.

import { it } from "vitest";

it("KeyM toggles mute", () => {
  throw new Error(
    "validation/structured-2d/controls/mute.test.ts: not implemented",
  );
});
