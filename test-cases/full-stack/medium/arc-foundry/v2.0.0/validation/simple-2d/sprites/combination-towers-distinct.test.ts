// Arc Foundry — `sprites.combination-towers-distinct`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `sprites/combination-towers-distinct.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The twelve combination tower head sprites are pairwise
// different images, and each differs from every base component head, so a
// tower is unmistakable beside a base component.
//
// HOW IT IS DECIDED. Decode the twelve tower heads and the forty component
// heads and compare their pixels. The evidence it hands back is `towers`
// (image): the twelve towers side by side.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("sprites.combination-towers-distinct", () => {
  it("The twelve towers are twelve different images", () => {
    fail(
      "a validator deciding this point",
      "the suite for `sprites.combination-towers-distinct` has not been written yet",
    );
  });
});
