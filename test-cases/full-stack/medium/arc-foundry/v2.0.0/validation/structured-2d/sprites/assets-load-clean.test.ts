// Arc Foundry — `sprites.assets-load-clean`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `sprites/assets-load-clean.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Driving a run through a build phase, a wave and the finale
// reports no failed asset load, so no produced file is missing from the built
// site or requested at a path that does not resolve.
//
// HOW IT IS DECIDED. Subscribe to the load failures before the game
// initializes and drive a run through all three phases. The evidence it hands
// back is `run` (replay): the run driven with every asset loaded.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("sprites.assets-load-clean", () => {
  it("Every asset the build asks for loads", () => {
    fail(
      "a validator deciding this point",
      "the suite for `sprites.assets-load-clean` has not been written yet",
    );
  });
});
