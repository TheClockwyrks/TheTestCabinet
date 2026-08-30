// Deepcore — fuel.out-of-fuel-at-the-surface-is-safe. STUB: NOT YET AUTHORED.
//
// An empty tank at the surface is not a death
//
// Fuel at 0 at or above the surface ground line is not a death: the miner
// stands in the camp, can still walk to the Fuel Depot and the expedition
// continues.
//
// Automated validation: pose fuel at 0 with the miner on the camp ground,
// advance a long span and hold the screen at in-mine.
//
// `test-case.toml` declares this suite as `fuel/out-of-fuel-at-the-surface-is-safe.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (dry (replay)) around the drive.

import { test } from "vitest";

test("An empty tank at the surface is not a death", () => {
  throw new Error(
    "Deepcore validator `fuel/out-of-fuel-at-the-surface-is-safe` is declared in test-case.toml but has not been authored yet.",
  );
});
