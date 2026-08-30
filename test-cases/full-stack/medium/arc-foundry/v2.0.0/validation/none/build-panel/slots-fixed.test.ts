// Arc Foundry — `build-panel.slots-fixed`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `build-panel/slots-fixed.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Every action a selected structure can ever offer is drawn
// for as long as it stays selected, each in its own slot and in a fixed order,
// and an action that is unavailable right now is reported disabled in its slot
// rather than missing from panelButtons.
//
// HOW IT IS DECIDED. Select a candidate with no partner, read panelButtons,
// give it a partner, and compare the two lists slot for slot. The evidence it
// hands back is `panel` (image): the inspector's fixed action slots.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("build-panel.slots-fixed", () => {
  it("Every action the selection can offer is drawn in its own slot", () => {
    fail(
      "a validator deciding this point",
      "the suite for `build-panel.slots-fixed` has not been written yet",
    );
  });
});
