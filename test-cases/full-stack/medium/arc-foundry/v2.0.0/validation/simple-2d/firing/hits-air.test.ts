// Arc Foundry — `firing.hits-air`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `firing/hits-air.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A Filament inside a structure's radius is a valid target:
// the structure fires at it and the Filament loses health, so there is no
// ground-only firing.
//
// HOW IT IS DECIDED. Park a frozen Filament in range of a Capacitor and read
// its health across ten seconds. The evidence it hands back is `air` (replay):
// the structure firing on a flyer.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("firing.hits-air", () => {
  it("Every firing structure hits a flyer", () => {
    fail(
      "a validator deciding this point",
      "the suite for `firing.hits-air` has not been written yet",
    );
  });
});
