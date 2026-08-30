// Arc Foundry — `load.filament-flies`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `load/filament-flies.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The Filament reports flying true and the other five roster
// types report flying false.
//
// HOW IT IS DECIDED. Release one of each type and read the flying flag back.
// The evidence it hands back is `roster` (image): the flying flag across the
// roster.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("load.filament-flies", () => {
  it("The Filament is the only flyer", () => {
    fail(
      "a validator deciding this point",
      "the suite for `load.filament-flies` has not been written yet",
    );
  });
});
