// Arc Foundry — `campaign.finale-invincible`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `campaign/finale-invincible.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Every point of damage dealt to the Overload Dynamo, direct
// hits and burn ticks alike, leaves its health where it is: it reports
// invincible true and its health never falls however much is fired at it.
//
// HOW IT IS DECIDED. Line the finale route with heavy structures and sample
// the Overload Dynamo's health across its walk. The evidence it hands back is
// `invincible` (replay): the Overload Dynamo taking fire without falling.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("campaign.finale-invincible", () => {
  it("The Overload Dynamo cannot be killed", () => {
    fail(
      "a validator deciding this point",
      "the suite for `campaign.finale-invincible` has not been written yet",
    );
  });
});
