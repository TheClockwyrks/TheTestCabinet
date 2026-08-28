// controls/sonar-key — space emits a sonar pulse.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// Pressing Space in live play with sonar.ready true puts a pulse in flight:
// pulses gains an entry with source forager, tint cyan, its origin tile the
// forager's own, and range equal to sonar.range.

import { it } from "vitest";

it("Space emits a sonar pulse", () => {
  throw new Error(
    "validation/simple-2d/controls/sonar-key.test.ts: not implemented",
  );
});
