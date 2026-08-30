// Arc Foundry — `animation.load-cycles-present`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `animation/load-cycles-present.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. assets/load/<type>/0.png through 3.png exist for all seven
// Load identifiers, the Overload Dynamo included, at 20 by 20 and at 32 by 32
// for the Slug, the Dynamo and the Overload Dynamo.
//
// HOW IT IS DECIDED. Read the twenty-eight files and decode each one's
// dimensions. The evidence it hands back is `load` (image): the Load's
// produced cycles.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("animation.load-cycles-present", () => {
  it("Every Load type has a four-frame cycle", () => {
    fail(
      "a validator deciding this point",
      "the suite for `animation.load-cycles-present` has not been written yet",
    );
  });
});
