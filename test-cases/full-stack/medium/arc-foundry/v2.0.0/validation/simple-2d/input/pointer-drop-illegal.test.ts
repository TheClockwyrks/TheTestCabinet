// Arc Foundry — `input.pointer-drop-illegal`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `input/pointer-drop-illegal.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Pressing on the yard while holding a rock over an illegal
// footprint places nothing, spends no stamp and leaves the rock held.
//
// HOW IT IS DECIDED. Arm a rock, move it over a waypoint platform, press, and
// read the held state and stampsLeft. The evidence it hands back is `illegal`
// (image): the rock still held over an illegal footprint.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("input.pointer-drop-illegal", () => {
  it("A press on an illegal footprint keeps the rock held", () => {
    fail(
      "a validator deciding this point",
      "the suite for `input.pointer-drop-illegal` has not been written yet",
    );
  });
});
