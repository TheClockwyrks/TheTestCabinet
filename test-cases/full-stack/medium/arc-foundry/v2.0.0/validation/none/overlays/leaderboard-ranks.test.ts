// Arc Foundry — `overlays.leaderboard-ranks`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `overlays/leaderboard-ranks.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The damage leaderboard draws the player's firing structures
// ordered by total damage dealt, highest first, with each structure's kills,
// and the order it draws changes live as a wave runs.
//
// HOW IT IS DECIDED. Drive known damage through three structures and read the
// leaderboard's text draws against their tallies. The evidence it hands back
// is `board` (replay): the damage leaderboard ranking three structures.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("overlays.leaderboard-ranks", () => {
  it("The leaderboard ranks structures by damage dealt", () => {
    fail(
      "a validator deciding this point",
      "the suite for `overlays.leaderboard-ranks` has not been written yet",
    );
  });
});
