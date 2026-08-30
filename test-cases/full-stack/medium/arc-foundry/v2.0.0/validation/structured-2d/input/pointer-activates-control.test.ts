// Arc Foundry — `input.pointer-activates-control`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `input/pointer-activates-control.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A press and release at the centre of any non-disabled
// rectangle menuButtons, panelButtons or statusControls reports activates that
// control, so a caller finds a choice without knowing where it was drawn.
//
// HOW IT IS DECIDED. Read each control's rectangle back and press at its
// centre, confirming the effect the control commits. The evidence it hands
// back is `press` (image): the control activated at its reported rectangle.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("input.pointer-activates-control", () => {
  it("A press at a reported rectangle activates its control", () => {
    fail(
      "a validator deciding this point",
      "the suite for `input.pointer-activates-control` has not been written yet",
    );
  });
});
