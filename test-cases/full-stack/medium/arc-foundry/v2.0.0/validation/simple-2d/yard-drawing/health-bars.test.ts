// Arc Foundry — `yard-drawing.health-bars`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `yard-drawing/health-bars.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A unit on the yard is drawn with a health bar above it, and
// the bar's drawn extent shrinks as the unit loses health: the extent at full
// health is longer than at a posed quarter health.
//
// HOW IT IS DECIDED. Park a frozen unit, sample its bar at full health, pose
// it to a quarter, and sample again. The evidence it hands back is `bar`
// (image): the health bar depleting.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("yard-drawing.health-bars", () => {
  it("Each unit carries a health bar that depletes", () => {
    fail(
      "a validator deciding this point",
      "the suite for `yard-drawing.health-bars` has not been written yet",
    );
  });
});
