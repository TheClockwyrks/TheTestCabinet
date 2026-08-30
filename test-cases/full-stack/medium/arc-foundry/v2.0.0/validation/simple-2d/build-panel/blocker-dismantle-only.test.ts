// Arc Foundry — `build-panel.blocker-dismantle-only`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `build-panel/blocker-dismantle-only.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Selecting a blocker reports exactly one action, dismantle,
// and the inspector draws that the blocker is inert with no stats.
//
// HOW IT IS DECIDED. Select a blocker and read panelButtons and the panel's
// text draws. The evidence it hands back is `panel` (image): the blocker's
// inspector.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("build-panel.blocker-dismantle-only", () => {
  it("A blocker offers DISMANTLE alone", () => {
    fail(
      "a validator deciding this point",
      "the suite for `build-panel.blocker-dismantle-only` has not been written yet",
    );
  });
});
