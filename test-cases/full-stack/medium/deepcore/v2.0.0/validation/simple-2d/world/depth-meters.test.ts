// Deepcore — world.depth-meters. STUB: NOT YET AUTHORED.
//
// Depth is reported in meters from the surface
//
// depthMeters is max(0, (y - SURFACE_Y) / TILE * METERS_PER_ROW) for the miner
// feet, with SURFACE_Y 80 and METERS_PER_ROW 5, so the top of row r reads
// METERS_PER_ROW * (r - 1) meters and a miner in the sky above the camp reads
// 0.
//
// Automated validation: pose the miner at the top of several known rows and
// above the surface, and hold depthMeters against the formula at each.
//
// `test-case.toml` declares this suite as `world/depth-meters.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (depth (image)) around the drive.

import { test } from "vitest";

test("Depth is reported in meters from the surface", () => {
  throw new Error(
    "Deepcore validator `world/depth-meters` is declared in test-case.toml but has not been authored yet.",
  );
});
