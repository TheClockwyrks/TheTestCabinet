// Deepcore — supplies.explosives-destroy-ore. STUB: NOT YET AUTHORED.
//
// Ore caught in a blast is lost
//
// Ore and gemstones inside an explosives block clear to tunnel like any other
// cell and are destroyed rather than banked, so blasting is not a harvesting
// technique.
//
// Automated validation: pose ore cells inside the block, use Dynamite and read
// the cargo unchanged with the cells left as tunnel.
//
// `test-case.toml` declares this suite as `supplies/explosives-destroy-ore.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (lost (replay)) around the drive.

import { test } from "vitest";

test("Ore caught in a blast is lost", () => {
  throw new Error(
    "Deepcore validator `supplies/explosives-destroy-ore` is declared in test-case.toml but has not been authored yet.",
  );
});
