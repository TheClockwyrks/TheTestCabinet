// Arc Foundry — `sprites.projectile-sprites`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `sprites/projectile-sprites.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. assets/projectiles/<type>.png exists as a 12 by 12 PNG for
// each of the seven firing base types.
//
// HOW IT IS DECIDED. Read the seven files and decode each one's dimensions.
// The evidence it hands back is `shots` (image): the produced projectiles in
// flight.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("sprites.projectile-sprites", () => {
  it("Every firing type has a produced projectile", () => {
    fail(
      "a validator deciding this point",
      "the suite for `sprites.projectile-sprites` has not been written yet",
    );
  });
});
