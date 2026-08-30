// Arc Foundry — `press.roll-on-landing`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `press/roll-on-landing.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Arming a rock rolls nothing: the snapshot reports no new
// structure and no roll while a rock is held, and the type and quality appear
// only once the rock has been dropped on a legal footprint.
//
// HOW IT IS DECIDED. Arm a rock, read the yard, drop it, and read the yard
// again. The evidence it hands back is `roll` (image): the candidate the drop
// rolled.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("press.roll-on-landing", () => {
  it("The roll happens when the rock lands", () => {
    fail(
      "a validator deciding this point",
      "the suite for `press.roll-on-landing` has not been written yet",
    );
  });
});
