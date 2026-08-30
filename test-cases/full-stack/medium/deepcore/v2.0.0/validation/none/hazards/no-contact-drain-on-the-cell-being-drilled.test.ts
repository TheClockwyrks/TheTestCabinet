// Deepcore — hazards.no-contact-drain-on-the-cell-being-drilled. STUB: NOT YET AUTHORED.
//
// The cell being drilled is not charged twice
//
// The contact drain is not charged on the cell currently being drilled: that
// cell heat is the lump alone, so cutting into lava costs the lump and not the
// lump plus a drain for the seconds the cut took.
//
// Automated validation: cut a posed lava cell through and hold the total hull
// lost against the lump alone, net of any other lava the box touches.
//
// `test-case.toml` declares this suite as `hazards/no-contact-drain-on-the-cell-being-drilled.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (once (replay)) around the drive.

import { test } from "vitest";

test("The cell being drilled is not charged twice", () => {
  throw new Error(
    "Deepcore validator `hazards/no-contact-drain-on-the-cell-being-drilled` is declared in test-case.toml but has not been authored yet.",
  );
});
