// Arc Foundry — `firing.head-rotates`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `firing/head-rotates.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A structure's reported heading points at the unit it is
// firing at, within a tenth of a radian, and it changes when the target moves
// to the other side of the structure.
//
// HOW IT IS DECIDED. Park a frozen unit on each side of a structure in turn
// and read the heading against the bearing to it. The evidence it hands back
// is `heading` (image): the head turned to its target.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("firing.head-rotates", () => {
  it("A firing head faces the unit it is firing at", () => {
    fail(
      "a validator deciding this point",
      "the suite for `firing.head-rotates` has not been written yet",
    );
  });
});
