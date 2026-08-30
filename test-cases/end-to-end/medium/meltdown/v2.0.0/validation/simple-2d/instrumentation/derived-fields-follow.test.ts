// Meltdown — instrumentation/derived-fields-follow: the derived run figures
// follow the mode and difficulty.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   waveCount, startMoney, startLives, interest and buildZone follow setMode
//   and setDifficulty with no other operation, and waveRemaining follows
//   wavePending and the live wave units.

import { it } from "vitest";

it("The derived run figures follow the mode and difficulty", () => {
  throw new Error(
    "Meltdown: validation/instrumentation/derived-fields-follow.test.ts is not implemented yet",
  );
});
