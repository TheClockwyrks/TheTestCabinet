// Arc Foundry — `campaign.build-phase-untimed`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `campaign/build-phase-untimed.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The build phase is untimed: over sixty seconds of
// simulation with no harvest committed, the phase still reads build, the wave
// number is unchanged and no unit has been released.
//
// HOW IT IS DECIDED. Sit in a build phase for sixty seconds of simulation and
// read the phase, the wave and the unit count. The evidence it hands back is
// `wait` (replay): the build phase waiting on the player.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("campaign.build-phase-untimed", () => {
  it("A build phase never starts a wave on its own", () => {
    fail(
      "a validator deciding this point",
      "the suite for `campaign.build-phase-untimed` has not been written yet",
    );
  });
});
