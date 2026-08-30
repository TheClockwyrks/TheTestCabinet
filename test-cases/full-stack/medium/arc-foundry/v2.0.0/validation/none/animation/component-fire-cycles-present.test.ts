// Arc Foundry — `animation.component-fire-cycles-present`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `animation/component-fire-cycles-present.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. assets/components/<type>/fire/0.png through 3.png exist for
// all eight base types, the Regulator's aura pulse included.
//
// HOW IT IS DECIDED. Read the thirty-two files and decode each one. The
// evidence it hands back is `fire` (image): the components' produced firing
// cycles.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("animation.component-fire-cycles-present", () => {
  it("Every component has a four-frame firing cycle", () => {
    fail(
      "a validator deciding this point",
      "the suite for `animation.component-fire-cycles-present` has not been written yet",
    );
  });
});
