// Arc Foundry — `build-panel.inspector-reads-the-selection`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `build-panel/inspector-reads-the-selection.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Selecting a base component draws its type, its quality
// tier, its one-line description and its live damage, range, fire rate and
// targeting priority, and selecting a combination tower draws its name, its
// upgrade level, its description, its stats and its abilities, each with the
// kills and total damage it has dealt.
//
// HOW IT IS DECIDED. Select a base component and a combination tower in turn
// and read the panel's text draws against the snapshot. The evidence it hands
// back is `inspector` (image): the inspector reading a selected structure.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("build-panel.inspector-reads-the-selection", () => {
  it("The inspector reads the selected structure", () => {
    fail(
      "a validator deciding this point",
      "the suite for `build-panel.inspector-reads-the-selection` has not been written yet",
    );
  });
});
