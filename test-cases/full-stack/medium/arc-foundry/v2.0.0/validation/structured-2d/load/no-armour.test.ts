// Arc Foundry — `load.no-armour`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `load/no-armour.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. There is no armour and no damage type: each of the seven
// firing base types removes health from each of the six Load types, ground and
// flying alike, and no unit resists or is immune.
//
// HOW IT IS DECIDED. Park each unit type in range of each firing type in turn
// and read the health each shot removed. The evidence it hands back is
// `matrix` (replay): the Load taking damage from every type.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("load.no-armour", () => {
  it("Every firing type removes health from every unit type", () => {
    fail(
      "a validator deciding this point",
      "the suite for `load.no-armour` has not been written yet",
    );
  });
});
