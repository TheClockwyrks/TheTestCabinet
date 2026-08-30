// Arc Foundry — `quality.plain-combine-midwave`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `quality/plain-combine-midwave.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A combine that consumes standing structures only resolves
// during a live wave and leaves the phase running: the phase still reads wave
// and the wave number is unchanged.
//
// HOW IT IS DECIDED. Start a wave, fold a pair of standing components, and
// read the phase and wave back. The evidence it hands back is `plain`
// (replay): the plain combine folded mid-wave.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("quality.plain-combine-midwave", () => {
  it("A plain combine resolves during a live wave", () => {
    fail(
      "a validator deciding this point",
      "the suite for `quality.plain-combine-midwave` has not been written yet",
    );
  });
});
