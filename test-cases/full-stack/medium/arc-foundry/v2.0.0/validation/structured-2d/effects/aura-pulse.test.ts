// Arc Foundry — `effects.aura-pulse`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `effects/aura-pulse.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Particles are drawn at a Regulator standing on the yard
// that are not drawn at a Capacitor standing in the same place, so the aura it
// projects is marked.
//
// HOW IT IS DECIDED. Stand a Regulator and a Capacitor at the same anchor in
// turn and sample the surrounding yard. The evidence it hands back is `aura`
// (replay): the pulse at an aura source.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("effects.aura-pulse", () => {
  it("A structure carrying an aura pulses", () => {
    fail(
      "a validator deciding this point",
      "the suite for `effects.aura-pulse` has not been written yet",
    );
  });
});
