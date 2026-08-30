// Deepcore — hazards.gas-blast-radius. STUB: NOT YET AUTHORED.
//
// A gas blast reaches only its stated radius
//
// The detonation damages the miner only while the miner centre is within
// GAS_BLAST_TILES (1.5) tiles of the pocket centre, and costs a miner beyond
// that radius nothing at all.
//
// Automated validation: detonate a posed pocket with the miner held just
// inside and just outside the radius by travel off, and read the hull at each.
//
// `test-case.toml` declares this suite as `hazards/gas-blast-radius.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (radius (replay)) around the drive.

import { test } from "vitest";

test("A gas blast reaches only its stated radius", () => {
  throw new Error(
    "Deepcore validator `hazards/gas-blast-radius` is declared in test-case.toml but has not been authored yet.",
  );
});
