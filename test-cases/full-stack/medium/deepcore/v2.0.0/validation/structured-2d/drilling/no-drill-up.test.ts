// Deepcore — drilling.no-drill-up. STUB: NOT YET AUTHORED.
//
// The ceiling is solid
//
// Thrusting up into rock above never removes a cell, so the only way to gain
// height is the jetpack through tunnels already carved.
//
// Automated validation: pose a solid ceiling over the miner, hold thrust for a
// sustained span and read the ceiling cell health and kind unchanged.
//
// `test-case.toml` declares this suite as `drilling/no-drill-up.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (ceiling (replay)) around the drive.

import { test } from "vitest";

test("The ceiling is solid", () => {
  throw new Error(
    "Deepcore validator `drilling/no-drill-up` is declared in test-case.toml but has not been authored yet.",
  );
});
