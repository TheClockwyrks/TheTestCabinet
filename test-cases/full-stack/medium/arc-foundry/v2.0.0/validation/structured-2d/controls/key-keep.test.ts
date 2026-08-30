// Arc Foundry — `controls.key-keep`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `controls/key-keep.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Pressing KeyK with a candidate selected harvests it as a
// permanent component and starts the wave.
//
// HOW IT IS DECIDED. Select a candidate, press KeyK, and read the structure
// and the phase back. The evidence it hands back is `kept` (image): the
// component the keep key harvested.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("controls.key-keep", () => {
  it("KeyK harvests the selected candidate", () => {
    fail(
      "a validator deciding this point",
      "the suite for `controls.key-keep` has not been written yet",
    );
  });
});
