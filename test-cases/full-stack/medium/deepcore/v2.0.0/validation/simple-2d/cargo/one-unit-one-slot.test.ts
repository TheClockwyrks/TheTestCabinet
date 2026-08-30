// Deepcore — cargo.one-unit-one-slot. STUB: NOT YET AUTHORED.
//
// A unit of any mineral fills one slot
//
// One unit of any ore or gemstone fills exactly one cargo slot whatever its
// weight, so the slot count is a count of units and not of kilograms.
//
// Automated validation: bank one unit each of the lightest and the heaviest
// mineral and hold slotsUsed against the unit count rather than the load.
//
// `test-case.toml` declares this suite as `cargo/one-unit-one-slot.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (slots (image)) around the drive.

import { test } from "vitest";

test("A unit of any mineral fills one slot", () => {
  throw new Error(
    "Deepcore validator `cargo/one-unit-one-slot` is declared in test-case.toml but has not been authored yet.",
  );
});
