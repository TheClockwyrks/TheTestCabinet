// Arc Foundry — `abilities.burn-refreshes-duration`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `abilities/burn-refreshes-duration.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A burn applied while another is running sets burnUntil to
// the simulation clock plus its own duration, even when its rate is the weaker
// of the two.
//
// HOW IT IS DECIDED. Apply a strong short burn, then a weak long one, and read
// burnUntil and the health lost past the first expiry. The evidence it hands
// back is `refresh` (replay): the refreshed burn outlasting the first.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("abilities.burn-refreshes-duration", () => {
  it("A fresh burn refreshes the duration", () => {
    fail(
      "a validator deciding this point",
      "the suite for `abilities.burn-refreshes-duration` has not been written yet",
    );
  });
});
