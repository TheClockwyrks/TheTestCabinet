// Meltdown — building/an-upgrade-does-not-restore-freshness: an upgrade does
// not make a tower fresh again.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A tower placed on an earlier wave and upgraded this build phase still
//   reports fresh false and still refunds 70%.

import { it } from "vitest";

it("An upgrade does not make a tower fresh again", () => {
  throw new Error(
    "Meltdown: validation/building/an-upgrade-does-not-restore-freshness.test.ts is not implemented yet",
  );
});
