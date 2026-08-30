// Arc Foundry — `abilities.slow-strongest-wins`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `abilities/slow-strongest-wins.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Applying a slow of a smaller amount while a stronger one is
// in effect leaves slowFactor at the stronger value, because an applied slow
// sets slowFactor to min(slowFactor, 1 - amount).
//
// HOW IT IS DECIDED. Apply a strong slow, then a weak one, and read slowFactor
// back. The evidence it hands back is `stack` (replay): the unit keeping the
// stronger slow.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("abilities.slow-strongest-wins", () => {
  it("A weaker slow does not weaken a stronger one", () => {
    fail(
      "a validator deciding this point",
      "the suite for `abilities.slow-strongest-wins` has not been written yet",
    );
  });
});
