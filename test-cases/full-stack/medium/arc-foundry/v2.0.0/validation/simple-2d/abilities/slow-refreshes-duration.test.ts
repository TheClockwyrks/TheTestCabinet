// Arc Foundry — `abilities.slow-refreshes-duration`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `abilities/slow-refreshes-duration.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A slow applied while another is in effect sets slowUntil to
// the simulation clock plus its own duration, even when its amount is the
// weaker of the two, so the unit stays slowed longer than the first slow alone
// would have held it.
//
// HOW IT IS DECIDED. Apply a strong short slow, then a weak long one, and read
// slowUntil and the unit's speed past the first expiry. The evidence it hands
// back is `refresh` (replay): the refreshed slow outlasting the first.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("abilities.slow-refreshes-duration", () => {
  it("A fresh slow refreshes the duration", () => {
    fail(
      "a validator deciding this point",
      "the suite for `abilities.slow-refreshes-duration` has not been written yet",
    );
  });
});
