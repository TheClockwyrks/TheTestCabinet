// Deepcore — fuel.out-of-fuel-death. STUB: NOT YET AUTHORED.
//
// Running dry underground ends the expedition
//
// Fuel reaching 0 while the miner is below the surface ground line strands it
// and ends the expedition at the game-over screen with the death cause
// fuel-out.
//
// Automated validation: pose a near-empty tank on a miner below the surface,
// burn the rest and read the screen and the summary death cause.
//
// `test-case.toml` declares this suite as `fuel/out-of-fuel-death.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (strand (replay)) around the drive.

import { test } from "vitest";

test("Running dry underground ends the expedition", () => {
  throw new Error(
    "Deepcore validator `fuel/out-of-fuel-death` is declared in test-case.toml but has not been authored yet.",
  );
});
