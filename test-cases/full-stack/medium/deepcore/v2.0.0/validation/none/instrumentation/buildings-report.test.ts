// Deepcore — instrumentation.buildings-report. STUB: NOT YET AUTHORED.
//
// buildings reports one entry per surface building
//
// buildings() returns exactly six entries, one per building id in
// specs/world.md (fuel-depot, ore-market, save-pad, upgrade-shop,
// supply-depot, launch-pad), each carrying a numeric x, y, w and h footprint
// in world units.
//
// Automated validation: read buildings() on a started expedition and hold the
// id set and each entry shape against the six buildings specs/world.md names.
//
// `test-case.toml` declares this suite as `instrumentation/buildings-report.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (camp (image)) around the drive.

import { test } from "vitest";

test("buildings reports one entry per surface building", () => {
  throw new Error(
    "Deepcore validator `instrumentation/buildings-report` is declared in test-case.toml but has not been authored yet.",
  );
});
