// Arc Foundry — `sprites.sprites-carry-content`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `sprites/sprites-carry-content.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. No produced sprite is a blank canvas: each carries pixels
// above an alpha of 8 over at least a twentieth of its area, so an absent
// asset cannot pass as a produced one.
//
// HOW IT IS DECIDED. Decode every produced PNG and measure the fraction of its
// pixels that are not transparent. The evidence it hands back is `sheet`
// (image): the produced sprites drawn together.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("sprites.sprites-carry-content", () => {
  it("Every produced sprite has something drawn on it", () => {
    fail(
      "a validator deciding this point",
      "the suite for `sprites.sprites-carry-content` has not been written yet",
    );
  });
});
