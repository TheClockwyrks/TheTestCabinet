// Arc Foundry — `press.harvest-starts-the-wave`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `press/harvest-starts-the-wave.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. There is no send control: the build phase runs until a
// harvest is committed, and the moment it is, the phase becomes wave and the
// wave number advances by one.
//
// HOW IT IS DECIDED. Sit in a build phase over ten seconds of simulation,
// confirm no wave started, then keep a candidate and read the phase. The
// evidence it hands back is `launch` (replay): the wave the harvest launched.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("press.harvest-starts-the-wave", () => {
  it("Committing the harvest is what starts the wave", () => {
    fail(
      "a validator deciding this point",
      "the suite for `press.harvest-starts-the-wave` has not been written yet",
    );
  });
});
