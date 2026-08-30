// Arc Foundry — `refinement.cost-table`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `refinement/cost-table.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Buying each level in turn spends exactly REFINEMENT_COSTS
// for that level — 20, 50, 80, 110, 140, 170, 200 and 230 — and raises the
// level by one.
//
// HOW IT IS DECIDED. Bank enough Charge and buy all eight levels, reading
// Charge and the level after each. The evidence it hands back is `costs`
// (image): the press at the top of the refinement track.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("refinement.cost-table", () => {
  it("Each refinement level costs its listed Charge", () => {
    fail(
      "a validator deciding this point",
      "the suite for `refinement.cost-table` has not been written yet",
    );
  });
});
