// Meltdown — waves/pause-freezes-the-floor: pausing freezes the floor.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   On the build's own clock, over two windows of the same length: a Mote must
//   travel more than PAUSE_MIN_TRAVEL in the first, and once paused must drift
//   less than PAUSE_MAX_DRIFT while simTime gains less than
//   PAUSE_MAX_CLOCK_DRIFT in the second, both readings taken from the one
//   snapshot on the press.

import { it } from "vitest";

it("Pausing freezes the floor", () => {
  throw new Error(
    "Meltdown: validation/waves/pause-freezes-the-floor.test.ts is not implemented yet",
  );
});
