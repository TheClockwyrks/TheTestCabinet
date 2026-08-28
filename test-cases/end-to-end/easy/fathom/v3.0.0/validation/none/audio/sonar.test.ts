// audio/sonar — the sonar cue.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// CUES.sonar ("sonar") plays on the tick the forager emits a sonar pulse,
// exactly once on that tick.

import { it } from "vitest";

it("The sonar cue", () => {
  throw new Error("validation/none/audio/sonar.test.ts: not implemented");
});
