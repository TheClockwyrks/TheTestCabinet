// Deepcore — cargo.sell-empties-the-bay. STUB: NOT YET AUTHORED.
//
// Selling converts the whole cargo and empties the bay
//
// The Ore Market sale takes the whole cargo, leaving no ore held, no slots
// used and a load of 0.
//
// Automated validation: pose a mixed bay, sell, and read the ore map,
// slotsUsed and loadKg back.
//
// `test-case.toml` declares this suite as `cargo/sell-empties-the-bay.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (sale (image)) around the drive.

import { test } from "vitest";

test("Selling converts the whole cargo and empties the bay", () => {
  throw new Error(
    "Deepcore validator `cargo/sell-empties-the-bay` is declared in test-case.toml but has not been authored yet.",
  );
});
