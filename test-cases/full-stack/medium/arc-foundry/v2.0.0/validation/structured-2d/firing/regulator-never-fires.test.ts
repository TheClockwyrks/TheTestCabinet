// Arc Foundry — `firing.regulator-never-fires`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `firing/regulator-never-fires.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A Regulator with a unit standing on top of it launches no
// projectile over ten seconds and reports a null range, a null targeting
// priority and zero damage.
//
// HOW IT IS DECIDED. Stand a Regulator, park a frozen unit on it, advance ten
// seconds, and read the projectiles and the structure back. The evidence it
// hands back is `quiet` (replay): the Regulator standing quiet under a unit.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("firing.regulator-never-fires", () => {
  it("A Regulator never fires", () => {
    fail(
      "a validator deciding this point",
      "the suite for `firing.regulator-never-fires` has not been written yet",
    );
  });
});
