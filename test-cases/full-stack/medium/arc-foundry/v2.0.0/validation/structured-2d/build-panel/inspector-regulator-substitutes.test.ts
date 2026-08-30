// Arc Foundry — `build-panel.inspector-regulator-substitutes`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `build-panel/inspector-regulator-substitutes.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Selecting a Regulator draws its aura radius and bonus in
// place of damage, range and fire rate.
//
// HOW IT IS DECIDED. Select a Regulator and read the panel's text draws
// against its reported auraRadius and auraBonus. The evidence it hands back is
// `inspector` (image): the Regulator's inspector.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("build-panel.inspector-regulator-substitutes", () => {
  it("A Regulator's inspector reads its aura instead", () => {
    fail(
      "a validator deciding this point",
      "the suite for `build-panel.inspector-regulator-substitutes` has not been written yet",
    );
  });
});
