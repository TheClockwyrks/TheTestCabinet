// Meltdown — modes/hundred-has-no-build-phases: the Hundred has no between-
// wave phases.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Posed with wavePending 0 and one live unit, clearing the onslaught ends
//   the run rather than opening a build phase. Interest is modes.hundred-
//   figures's business, not this item's.

import { it } from "vitest";

it("The Hundred has no between-wave phases", () => {
  throw new Error(
    "Meltdown: validation/modes/hundred-has-no-build-phases.test.ts is not implemented yet",
  );
});
