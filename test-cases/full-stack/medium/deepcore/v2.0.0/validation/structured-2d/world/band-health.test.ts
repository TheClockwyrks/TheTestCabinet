// Deepcore — world.band-health. STUB: NOT YET AUTHORED.
//
// Every minable cell starts at its band health
//
// A freshly generated or posed minable cell reports maxHealth equal to its
// band BAND_HEALTH: 4 in the topsoil, 8 in the rockbed, 12 in the deepstone
// and 16 in the coreshell, and starts at that health.
//
// Automated validation: pose a rock cell in each of the four bands and hold
// its health and maxHealth against BAND_HEALTH.
//
// `test-case.toml` declares this suite as `world/band-health.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (health (image)) around the drive.

import { test } from "vitest";

test("Every minable cell starts at its band health", () => {
  throw new Error(
    "Deepcore validator `world/band-health` is declared in test-case.toml but has not been authored yet.",
  );
});
