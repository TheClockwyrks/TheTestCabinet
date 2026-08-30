// Arc Foundry — `effects.bolt-trail`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `effects/bolt-trail.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Particles are drawn along the line between a firing
// Capacitor's head and its target while its projectile travels, and none are
// drawn on that line before the shot.
//
// HOW IT IS DECIDED. Sample the line from head to target before a shot and
// mid-flight. The evidence it hands back is `bolt` (replay): the bolt trailing
// to its target.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("effects.bolt-trail", () => {
  it("A travelling bolt carries a trail", () => {
    fail(
      "a validator deciding this point",
      "the suite for `effects.bolt-trail` has not been written yet",
    );
  });
});
