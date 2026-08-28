// alert/flarefish — the Flarefish fires the alert on a fresh fix.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A Flarefish acquiring the forager, by its light sense or by a flare lock,
// reports alert true from that step and for ALERT_TIME (0.5 s) within a tenth
// of a second, and lit true for that whole window wherever it stands.

import { it } from "vitest";

it("The Flarefish fires the alert on a fresh fix", () => {
  throw new Error(
    "validation/simple-2d/alert/flarefish.test.ts: not implemented",
  );
});
