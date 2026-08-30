// Arc Foundry — `abilities.arcnode-splash-flat`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `abilities/arcnode-splash-flat.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Every unit inside the splash radius loses the same health,
// whatever its distance from the impact point, so there is no falloff.
//
// HOW IT IS DECIDED. Park frozen units at several distances inside the radius
// and compare the health each lost. The evidence it hands back is `flat`
// (replay): the units inside the splash losing equal health.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("abilities.arcnode-splash-flat", () => {
  it("Splash damage is flat inside the radius", () => {
    fail(
      "a validator deciding this point",
      "the suite for `abilities.arcnode-splash-flat` has not been written yet",
    );
  });
});
