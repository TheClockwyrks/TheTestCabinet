// Arc Foundry — `load.cluster-and-slug-late`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `load/cluster-and-slug-late.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. No wave numbered 1 through 4 releases a Cluster or a Slug.
//
// HOW IT IS DECIDED. Play the first four waves and record the type of every
// unit released. The evidence it hands back is `early` (replay): the early
// waves without Clusters or Slugs.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("load.cluster-and-slug-late", () => {
  it("Neither Clusters nor Slugs appear before wave 5", () => {
    fail(
      "a validator deciding this point",
      "the suite for `load.cluster-and-slug-late` has not been written yet",
    );
  });
});
