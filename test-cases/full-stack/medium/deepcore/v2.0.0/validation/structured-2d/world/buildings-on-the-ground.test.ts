// Deepcore — world.buildings-on-the-ground. STUB: NOT YET AUTHORED.
//
// Every building stands on the ground line
//
// Each of the six building footprints has y + h equal to SURFACE_Y (80) and
// lies within columns 1 to 30, so every building rises from the camp ground
// into the open sky and none sits over the border.
//
// Automated validation: read buildings() and hold each footprint base against
// SURFACE_Y and each horizontal extent inside the playable columns.
//
// `test-case.toml` declares this suite as `world/buildings-on-the-ground.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (camp (image)) around the drive.

import { test } from "vitest";

test("Every building stands on the ground line", () => {
  throw new Error(
    "Deepcore validator `world/buildings-on-the-ground` is declared in test-case.toml but has not been authored yet.",
  );
});
