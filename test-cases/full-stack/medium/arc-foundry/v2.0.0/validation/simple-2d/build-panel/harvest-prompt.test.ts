// Arc Foundry — `build-panel.harvest-prompt`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `build-panel/harvest-prompt.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The panel draws HARVEST_PROMPT_START (KEEP OR COMBINE A
// ROLL TO START) during the build phase before wave 1, and HARVEST_PROMPT_SEND
// (KEEP OR COMBINE A ROLL TO SEND) during every build phase after it.
//
// HOW IT IS DECIDED. Read the panel's text draws in the opening build phase
// and in the one after wave 1 clears. The evidence it hands back is `prompt`
// (image): the harvest prompt in both phases.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("build-panel.harvest-prompt", () => {
  it("The harvest prompt reads START before wave 1 and SEND after", () => {
    fail(
      "a validator deciding this point",
      "the suite for `build-panel.harvest-prompt` has not been written yet",
    );
  });
});
