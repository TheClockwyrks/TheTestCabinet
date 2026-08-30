// Meltdown — waves/opening-phase-is-untimed: the opening phase never starts on
// its own.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   With the run's release of surge on, the opening phase reports buildTimer 0
//   and stays in opening over a minute of game time.

import { it } from "vitest";

it("The opening phase never starts on its own", () => {
  throw new Error(
    "Meltdown: validation/waves/opening-phase-is-untimed.test.ts is not implemented yet",
  );
});
