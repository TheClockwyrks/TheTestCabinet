// Arc Foundry — `pathing.no-recompute-midwave`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `pathing/no-recompute-midwave.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. During a live wave, refining the press, upgrading a
// combination tower and cycling a targeting priority all leave the maze length
// untouched, so a wave walks the maze it started with.
//
// HOW IT IS DECIDED. Start a wave, take each mid-wave action in turn, and
// compare the maze length against the reading at the wave's start. The
// evidence it hands back is `unchanged` (replay): the maze holding still
// across a wave.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("pathing.no-recompute-midwave", () => {
  it("Nothing available during a wave changes a tile", () => {
    fail(
      "a validator deciding this point",
      "the suite for `pathing.no-recompute-midwave` has not been written yet",
    );
  });
});
