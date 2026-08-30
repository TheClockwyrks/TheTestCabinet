// Arc Foundry — `effects.bolt-escalates`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `effects/bolt-escalates.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The pixels drawn along the line from head to target while a
// Tesla-Prime Capacitor's shot travels differ from those drawn in the
// identical scenario under a Scrap Capacitor, so the quality ladder reads in
// the effect as well as in the sprite.
//
// HOW IT IS DECIDED. Fire the same shot at the same target from a Scrap and a
// Tesla-Prime Capacitor and compare the pixels along the line. The evidence it
// hands back is `bolts` (replay): a Scrap bolt and a Tesla-Prime bolt.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("effects.bolt-escalates", () => {
  it("A Tesla-Prime bolt is not a Scrap bolt", () => {
    fail(
      "a validator deciding this point",
      "the suite for `effects.bolt-escalates` has not been written yet",
    );
  });
});
