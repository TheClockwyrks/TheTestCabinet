// Arc Foundry — `yard.build-beside-waypoint`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `yard/build-beside-waypoint.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Only the platform's own four tiles are protected: a
// placement that merely touches the platform — hugging an arm, sitting on the
// anchor row beyond an arm, alongside the stem, or diagonally at a corner — is
// ACCEPTED, so the non-buildable zone is not dilated to the tiles around the
// waypoint.
//
// HOW IT IS DECIDED. Take four placements that touch a platform without
// covering any of its tiles and read each back. The evidence it hands back is
// `beside` (image): accepted placements hugging a waypoint platform.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("yard.build-beside-waypoint", () => {
  it("The tiles beside a waypoint platform are buildable", () => {
    fail(
      "a validator deciding this point",
      "the suite for `yard.build-beside-waypoint` has not been written yet",
    );
  });
});
