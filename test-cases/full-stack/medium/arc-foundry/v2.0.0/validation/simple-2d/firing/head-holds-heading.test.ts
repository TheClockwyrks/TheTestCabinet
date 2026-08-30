// Arc Foundry — `firing.head-holds-heading`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `firing/head-holds-heading.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Once the target is gone the structure reports firing false
// and holds the heading it last fired on rather than snapping back to a
// resting angle.
//
// HOW IT IS DECIDED. Fire at a unit, clear the units, advance, and compare the
// heading against the one before the clear. The evidence it hands back is
// `held` (image): the head holding its last heading.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("firing.head-holds-heading", () => {
  it("A head holds its last heading while it holds fire", () => {
    fail(
      "a validator deciding this point",
      "the suite for `firing.head-holds-heading` has not been written yet",
    );
  });
});
