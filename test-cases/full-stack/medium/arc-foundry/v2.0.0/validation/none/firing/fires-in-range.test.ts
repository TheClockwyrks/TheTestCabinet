// Arc Foundry — `firing.fires-in-range`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `firing/fires-in-range.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A firing structure with a unit whose position lies within
// its range launches projectiles, and the structure reports firing true.
//
// HOW IT IS DECIDED. Stand a Capacitor, park a frozen unit inside its radius,
// advance, and count the projectiles that appeared. The evidence it hands back
// is `fire` (replay): the structure firing at a unit in range.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("firing.fires-in-range", () => {
  it("A structure fires at a unit inside its radius", () => {
    fail(
      "a validator deciding this point",
      "the suite for `firing.fires-in-range` has not been written yet",
    );
  });
});
