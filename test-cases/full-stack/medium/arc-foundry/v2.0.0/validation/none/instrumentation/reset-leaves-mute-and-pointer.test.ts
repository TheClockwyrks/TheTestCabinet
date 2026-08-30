// Arc Foundry — `instrumentation.reset-leaves-mute-and-pointer`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `instrumentation/reset-leaves-mute-and-pointer.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Two fields survive a reset because both belong to the
// runtime rather than to the game: with audio muted and the pointer moved,
// reset leaves muted true and leaves the reported pointer where it was.
//
// HOW IT IS DECIDED. Mute, move the pointer, reset, and read both fields back.
// The evidence it hands back is `title` (image): the title after a reset that
// kept the mute bit.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("instrumentation.reset-leaves-mute-and-pointer", () => {
  it("reset leaves the mute bit and the pointer untouched", () => {
    fail(
      "a validator deciding this point",
      "the suite for `instrumentation.reset-leaves-mute-and-pointer` has not been written yet",
    );
  });
});
