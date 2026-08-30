// Arc Foundry — `screens.howto-names-the-keys`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `screens/howto-names-the-keys.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The how-to screen draws text naming each key BINDINGS
// binds, so a player reads the controls without leaving it.
//
// HOW IT IS DECIDED. Open the how-to screen and read the text draws against
// BINDINGS. The evidence it hands back is `howto` (image): the how-to screen's
// controls.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("screens.howto-names-the-keys", () => {
  it("The how-to screen names the controls", () => {
    fail(
      "a validator deciding this point",
      "the suite for `screens.howto-names-the-keys` has not been written yet",
    );
  });
});
