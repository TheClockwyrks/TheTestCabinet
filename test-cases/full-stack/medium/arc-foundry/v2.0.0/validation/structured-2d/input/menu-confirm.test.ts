// Arc Foundry — `input.menu-confirm`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `input/menu-confirm.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. On a menu the confirm action takes exactly the entry at the
// current menu index, so highlighting the second entry and confirming leads
// where that entry leads.
//
// HOW IT IS DECIDED. Highlight each entry of a menu in turn, confirm, and read
// the screen it led to. The evidence it hands back is `confirm` (image): the
// entry the confirm action took.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("input.menu-confirm", () => {
  it("The confirm action takes the highlighted entry", () => {
    fail(
      "a validator deciding this point",
      "the suite for `input.menu-confirm` has not been written yet",
    );
  });
});
