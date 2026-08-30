// Arc Foundry — `yard-drawing.held-footprint-legal-read`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `yard-drawing/held-footprint-legal-read.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The held rock's snapped footprint is drawn distinctly by
// legality: the pixels sampled inside the footprint over a legal tile and over
// a waypoint platform differ by more than 50 of 441 in RGB distance.
//
// HOW IT IS DECIDED. Arm a rock, move it over a legal footprint and over a
// platform, and sample the footprint in each. The evidence it hands back is
// `held` (image): the held footprint's legal and illegal reads.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("yard-drawing.held-footprint-legal-read", () => {
  it("A legal footprint reads differently from an illegal one", () => {
    fail(
      "a validator deciding this point",
      "the suite for `yard-drawing.held-footprint-legal-read` has not been written yet",
    );
  });
});
