// Arc Foundry — `targeting.default-first`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `targeting/default-first.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A component, a candidate that has been harvested and a
// combination tower each report targeting first the moment they land, before
// any priority has been chosen.
//
// HOW IT IS DECIDED. Stand one of each and read the reported targeting back.
// The evidence it hands back is `default` (image): the default priority on a
// fresh structure.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("targeting.default-first", () => {
  it("Every firing structure defaults to first", () => {
    fail(
      "a validator deciding this point",
      "the suite for `targeting.default-first` has not been written yet",
    );
  });
});
