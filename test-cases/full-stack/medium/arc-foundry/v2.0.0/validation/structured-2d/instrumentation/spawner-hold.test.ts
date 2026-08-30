// Arc Foundry — `instrumentation.spawner-hold`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `instrumentation/spawner-hold.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. spawnUnit releases exactly the unit it names and puts the
// run into a live wave whose spawn schedule is empty: over ten seconds of
// simulation no other unit arrives, and the wave clears the ordinary way once
// that unit has died or leaked.
//
// HOW IT IS DECIDED. Release one unit from a build phase, advance ten seconds,
// and count what reached the yard. The evidence it hands back is `hold`
// (replay): the single released unit walking an otherwise empty wave.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("instrumentation.spawner-hold", () => {
  it("spawnUnit holds the wave's own spawner", () => {
    fail(
      "a validator deciding this point",
      "the suite for `instrumentation.spawner-hold` has not been written yet",
    );
  });
});
