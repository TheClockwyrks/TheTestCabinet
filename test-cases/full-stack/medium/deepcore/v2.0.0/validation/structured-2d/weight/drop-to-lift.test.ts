// Deepcore — weight.drop-to-lift. STUB: NOT YET AUTHORED.
//
// Dropping ore restores lift
//
// Discarding units from the inventory until the load falls under the lift
// limit clears the overload, and the miner climbs again on the next thrust.
//
// Automated validation: pose an overloaded bay, drop units until the flag
// clears, then hold thrust and hold the height gained above where it started.
//
// `test-case.toml` declares this suite as `weight/drop-to-lift.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (shed (replay)) around the drive.

import { test } from "vitest";

test("Dropping ore restores lift", () => {
  throw new Error(
    "Deepcore validator `weight/drop-to-lift` is declared in test-case.toml but has not been authored yet.",
  );
});
