// gloamfin/fix-and-alert — close hearing takes a fix and fires the alert.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// The forager brought within GLOAMFIN_HEAR (64) of a wandering Gloamfin's
// center, through rock and with no light on either, hands it a fix:
// hearingLock becomes true, state becomes chase, and alert becomes true on
// that same step.

import { it } from "vitest";

it("Close hearing takes a fix and fires the alert", () => {
  throw new Error(
    "validation/none/gloamfin/fix-and-alert.test.ts: not implemented",
  );
});
