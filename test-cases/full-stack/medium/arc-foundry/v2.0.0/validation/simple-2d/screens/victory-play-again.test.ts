// Arc Foundry — `screens.victory-play-again`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `screens/victory-play-again.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Taking PLAY AGAIN from the victory screen begins a fresh
// run on the same map at the same difficulty.
//
// HOW IT IS DECIDED. Reach the victory screen, take PLAY AGAIN, and read the
// opening state, map and difficulty. The evidence it hands back is `again`
// (image): the fresh run a replay began.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("screens.victory-play-again", () => {
  it("PLAY AGAIN replays the same run", () => {
    fail(
      "a validator deciding this point",
      "the suite for `screens.victory-play-again` has not been written yet",
    );
  });
});
