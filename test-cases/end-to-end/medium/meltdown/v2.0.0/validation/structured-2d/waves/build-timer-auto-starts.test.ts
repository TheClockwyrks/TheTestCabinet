// Meltdown — waves/build-timer-auto-starts: the timer starts the wave on its
// own.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   With the run's release of surge on, a build timer reaching 0 moves the
//   phase to wave.

import { it } from "vitest";

it("The timer starts the wave on its own", () => {
  throw new Error(
    "Meltdown: validation/waves/build-timer-auto-starts.test.ts is not implemented yet",
  );
});
