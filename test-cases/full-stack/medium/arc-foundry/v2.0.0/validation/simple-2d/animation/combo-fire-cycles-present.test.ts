// Arc Foundry — `animation.combo-fire-cycles-present`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `animation/combo-fire-cycles-present.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. assets/combos/<id>/fire/0.png through 3.png exist for all
// twelve combination towers.
//
// HOW IT IS DECIDED. Read the forty-eight files and decode each one. The
// evidence it hands back is `fire` (image): the towers' produced firing
// cycles.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("animation.combo-fire-cycles-present", () => {
  it("Every combination tower has a firing cycle", () => {
    fail(
      "a validator deciding this point",
      "the suite for `animation.combo-fire-cycles-present` has not been written yet",
    );
  });
});
