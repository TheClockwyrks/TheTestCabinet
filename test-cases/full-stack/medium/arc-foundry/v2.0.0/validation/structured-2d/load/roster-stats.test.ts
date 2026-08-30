// Arc Foundry — `load.roster-stats`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `load/roster-stats.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Each of the six types reports the speed, flying flag,
// bounty and leak value the roster fixes: a Mote at 60 and 1 and 1, a Spark at
// 120, a Slug at 38 with a leak of 2, a Cluster at 72, a Filament at 85 and
// flying, and a Dynamo at 30 with a bounty of 40 and a leak of 5.
//
// HOW IT IS DECIDED. Release one of each type and hold its reported figures
// against the roster, driving one kill and one leak of each. The evidence it
// hands back is `roster` (replay): the six types on the yard.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("load.roster-stats", () => {
  it("Each Load type carries its roster figures", () => {
    fail(
      "a validator deciding this point",
      "the suite for `load.roster-stats` has not been written yet",
    );
  });
});
