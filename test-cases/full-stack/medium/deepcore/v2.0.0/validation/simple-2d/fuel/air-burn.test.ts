// Deepcore — fuel.air-burn. STUB: NOT YET AUTHORED.
//
// Drifting laterally in the air costs fuel
//
// Holding left or right while airborne burns AIR_BURN (2) fuel per second, so
// steering a fall is not free.
//
// Automated validation: hold the miner airborne with travel off, hold right
// for a fixed span with no thrust and hold the fuel spent against AIR_BURN
// times the span.
//
// `test-case.toml` declares this suite as `fuel/air-burn.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (drift (replay)) around the drive.

import { test } from "vitest";

test("Drifting laterally in the air costs fuel", () => {
  throw new Error(
    "Deepcore validator `fuel/air-burn` is declared in test-case.toml but has not been authored yet.",
  );
});
