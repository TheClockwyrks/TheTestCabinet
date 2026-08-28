// sonar/heard-by-gloamfin — a pulse is heard by the Gloamfin.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A wandering Gloamfin the front reaches turns to chase: its state becomes
// chase on the front's ARRIVAL, not at the moment the pulse was emitted, so a
// Gloamfin several steps out keeps wandering until the front gets there.

import { it } from "vitest";

it("A pulse is heard by the Gloamfin", () => {
  throw new Error(
    "validation/none/sonar/heard-by-gloamfin.test.ts: not implemented",
  );
});
