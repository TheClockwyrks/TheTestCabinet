// alert/gloamfin — the Gloamfin fires the alert on a fresh fix.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A Gloamfin acquiring the forager reports alert true from that step and for
// ALERT_TIME (0.5 s) within a tenth of a second, lit true for that whole
// window wherever it stands, and alert false thereafter, and refreshing a fix
// it is already chasing on fires nothing.

import { it } from "vitest";

it("The Gloamfin fires the alert on a fresh fix", () => {
  throw new Error(
    "validation/structured-2d/alert/gloamfin.test.ts: not implemented",
  );
});
