// Arc Foundry — `pathing.never-seal-unit-route`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `pathing/never-seal-unit-route.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A placement that would leave a unit already on the yard
// with no open route to the checkpoint it is heading for is refused, even when
// every leg of the chain would still be open.
//
// HOW IT IS DECIDED. Park a unit in a pocket, attempt the placement that
// closes its only way out, and read the structure count back. The evidence it
// hands back is `refused` (image): the refused placement that would strand a
// unit.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("pathing.never-seal-unit-route", () => {
  it("A placement that would strand a unit on the yard is refused", () => {
    fail(
      "a validator deciding this point",
      "the suite for `pathing.never-seal-unit-route` has not been written yet",
    );
  });
});
