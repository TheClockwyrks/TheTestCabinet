// Arc Foundry — `controls.key-stamp`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `controls/key-stamp.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Pressing KeyB during a build phase arms a blank rock on the
// cursor, and the held state reads active.
//
// HOW IT IS DECIDED. Press KeyB in a build phase and read the held state back.
// The evidence it hands back is `armed` (image): the rock armed by the press
// key.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("controls.key-stamp", () => {
  it("KeyB pulls the press", () => {
    fail(
      "a validator deciding this point",
      "the suite for `controls.key-stamp` has not been written yet",
    );
  });
});
