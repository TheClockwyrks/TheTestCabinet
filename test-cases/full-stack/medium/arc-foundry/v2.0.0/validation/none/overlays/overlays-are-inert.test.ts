// Arc Foundry — `overlays.overlays-are-inert`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `overlays/overlays-are-inert.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Opening either overlay leaves the simulation running: over
// ten seconds of simulation with the recipe book open and again with the
// leaderboard open, simTime and the units advance exactly as they do with both
// closed.
//
// HOW IT IS DECIDED. Advance ten seconds with each overlay open and with both
// closed and compare simTime and the unit positions. The evidence it hands
// back is `inert` (replay): the wave running under an open overlay.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("overlays.overlays-are-inert", () => {
  it("Neither overlay pauses or alters the game", () => {
    fail(
      "a validator deciding this point",
      "the suite for `overlays.overlays-are-inert` has not been written yet",
    );
  });
});
