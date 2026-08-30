// Arc Foundry — `sprites.component-base-sprites`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `sprites/component-base-sprites.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. assets/components/<type>/base.png exists as a 40 by 40 PNG
// for each of the eight base component identifiers.
//
// HOW IT IS DECIDED. Read the eight files and decode each one's dimensions.
// The evidence it hands back is `mounts` (image): the eight component mounts.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("sprites.component-base-sprites", () => {
  it("Every base component has a produced mount", () => {
    fail(
      "a validator deciding this point",
      "the suite for `sprites.component-base-sprites` has not been written yet",
    );
  });
});
