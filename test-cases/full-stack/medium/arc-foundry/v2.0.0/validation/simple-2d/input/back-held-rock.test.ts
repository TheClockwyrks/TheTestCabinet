// Arc Foundry — `input.back-held-rock`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `input/back-held-rock.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. With a rock held, the back action puts it away and does
// nothing else: the selection, the overlays and the screen are all unchanged.
//
// HOW IT IS DECIDED. Arm a rock with a structure selected and an overlay open,
// take back once, and read every one of those. The evidence it hands back is
// `back` (image): the rock the back action put away.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("input.back-held-rock", () => {
  it("back puts a held rock away first", () => {
    fail(
      "a validator deciding this point",
      "the suite for `input.back-held-rock` has not been written yet",
    );
  });
});
