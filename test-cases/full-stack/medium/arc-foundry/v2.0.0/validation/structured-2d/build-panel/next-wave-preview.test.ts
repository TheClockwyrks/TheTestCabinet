// Arc Foundry — `build-panel.next-wave-preview`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `build-panel/next-wave-preview.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. With no structure selected the panel draws the coming
// wave's unit types, and the types it draws change as the run deepens.
//
// HOW IT IS DECIDED. Clear the selection in two different build phases and
// read the panel's text draws. The evidence it hands back is `preview`
// (image): the next-wave preview.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("build-panel.next-wave-preview", () => {
  it("With nothing selected the panel previews the coming wave", () => {
    fail(
      "a validator deciding this point",
      "the suite for `build-panel.next-wave-preview` has not been written yet",
    );
  });
});
