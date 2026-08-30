// Arc Foundry — `controls.key-combine`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `controls/key-combine.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Pressing KeyC with a base structure selected that has a
// matching partner commits the fold.
//
// HOW IT IS DECIDED. Stand a matching pair, select one, press KeyC, and read
// the result. The evidence it hands back is `folded` (image): the fold the
// combine key committed.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("controls.key-combine", () => {
  it("KeyC commits a combine from the selection", () => {
    fail(
      "a validator deciding this point",
      "the suite for `controls.key-combine` has not been written yet",
    );
  });
});
