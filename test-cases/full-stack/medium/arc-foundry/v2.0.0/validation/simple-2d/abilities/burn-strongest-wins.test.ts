// Arc Foundry — `abilities.burn-strongest-wins`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `abilities/burn-strongest-wins.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Applying a burn of a lower damage-per-second while a
// stronger one is running leaves burnDps at the stronger value, because an
// applied burn sets burnDps to max(burnDps, dps).
//
// HOW IT IS DECIDED. Apply a strong burn, then a weak one, and read burnDps
// and the health lost. The evidence it hands back is `stack` (replay): the
// unit keeping the stronger burn.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("abilities.burn-strongest-wins", () => {
  it("A weaker burn does not lower the burn rate", () => {
    fail(
      "a validator deciding this point",
      "the suite for `abilities.burn-strongest-wins` has not been written yet",
    );
  });
});
