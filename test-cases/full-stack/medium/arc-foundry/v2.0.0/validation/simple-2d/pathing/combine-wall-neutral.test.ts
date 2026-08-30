// Arc Foundry — `pathing.combine-wall-neutral`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `pathing/combine-wall-neutral.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A combine hardens every footprint it consumes into a
// blocker rather than freeing it, and lands its result on the initiating
// footprint, so the reported maze length is identical before and after the
// combine.
//
// HOW IT IS DECIDED. Read the maze length, fold a pair standing in the maze,
// and read it again. The evidence it hands back is `neutral` (replay): a
// combine leaving the maze wall intact.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("pathing.combine-wall-neutral", () => {
  it("A combine is wall-neutral", () => {
    fail(
      "a validator deciding this point",
      "the suite for `pathing.combine-wall-neutral` has not been written yet",
    );
  });
});
