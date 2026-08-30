// Deepcore — hazards.lava-drill-lump-deepstone. STUB: NOT YET AUTHORED.
//
// Drilling a deepstone lava cell burns a lump of hull
//
// Breaking a deepstone lava cell deals LAVA_DRILL_DEEPSTONE (60) hull once as
// the cell breaks, at radiator tier 1, and the cell clears to open tunnel.
//
// Automated validation: pose a deepstone lava cell under the miner, cut it
// through and hold the hull lost at the break against LAVA_DRILL_DEEPSTONE.
//
// `test-case.toml` declares this suite as `hazards/lava-drill-lump-deepstone.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (lump (replay)) around the drive.

import { test } from "vitest";

test("Drilling a deepstone lava cell burns a lump of hull", () => {
  throw new Error(
    "Deepcore validator `hazards/lava-drill-lump-deepstone` is declared in test-case.toml but has not been authored yet.",
  );
});
