// Arc Foundry — `animation.fire-cycle-plays-on-a-shot`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `animation/fire-cycle-plays-on-a-shot.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The pixels drawn inside a structure's footprint differ
// between the frame it fires on and a frame while it is holding fire, so the
// produced firing cycle is played on the shot rather than sitting unused.
//
// HOW IT IS DECIDED. Sample the footprint on the frame a shot is launched and
// on a frame with nothing in range. The evidence it hands back is `shot`
// (replay): the firing cycle on the frame of a shot.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("animation.fire-cycle-plays-on-a-shot", () => {
  it("A firing cycle plays when a structure fires", () => {
    fail(
      "a validator deciding this point",
      "the suite for `animation.fire-cycle-plays-on-a-shot` has not been written yet",
    );
  });
});
