// Arc Foundry — `abilities.arcnode-splash-radius`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `abilities/arcnode-splash-radius.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. An Arc-Node's shot deals its full damage to every unit
// whose position lies within ARCNODE_SPLASH[tier] of the impact point — 42 at
// Scrap rising 5 a tier to 62 — and to no unit outside it.
//
// HOW IT IS DECIDED. Park frozen units just inside and just outside the radius
// and fire one shot. The evidence it hands back is `splash` (replay): the
// splash covering its radius.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("abilities.arcnode-splash-radius", () => {
  it("An Arc-Node discharges over ARCNODE_SPLASH", () => {
    fail(
      "a validator deciding this point",
      "the suite for `abilities.arcnode-splash-radius` has not been written yet",
    );
  });
});
