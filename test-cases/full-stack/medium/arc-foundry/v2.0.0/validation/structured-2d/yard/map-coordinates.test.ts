// Arc Foundry — `yard.map-coordinates`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `yard/map-coordinates.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The Substation, The Switchyard and The Transformer Yard
// each report the entry, the six ordered waypoints WP1 through WP6, and the
// collector at exactly the tiles specs/yard.md pins for them, so the maps are
// chosen rather than generated.
//
// HOW IT IS DECIDED. Set each map in turn and hold the reported entry,
// waypoints and collector against the three tables. The evidence it hands back
// is `substation` (image): the Substation's waypoint layout.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("yard.map-coordinates", () => {
  it("Each map's chain sits at its pinned tiles", () => {
    fail(
      "a validator deciding this point",
      "the suite for `yard.map-coordinates` has not been written yet",
    );
  });
});
