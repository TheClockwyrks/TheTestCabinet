// Arc Foundry — `press.keep-harvests`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `press/keep-harvests.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Keeping the selected candidate makes it a permanent
// component at exactly the type and quality it rolled, reported with kind
// component, and it fires from then on.
//
// HOW IT IS DECIDED. Arm a known roll, drop it, keep it, and read the
// resulting structure back. The evidence it hands back is `kept` (image): the
// kept component.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("press.keep-harvests", () => {
  it("KEEP turns the candidate into a permanent component", () => {
    fail(
      "a validator deciding this point",
      "the suite for `press.keep-harvests` has not been written yet",
    );
  });
});
