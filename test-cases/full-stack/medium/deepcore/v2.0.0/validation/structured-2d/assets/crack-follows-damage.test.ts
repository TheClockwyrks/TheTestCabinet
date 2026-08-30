// Deepcore — assets.crack-follows-damage. STUB: NOT YET AUTHORED.
//
// The crack drawn on a cell follows its damage
//
// The crack frame drawn over a cell is picked from its damage fraction, 1 -
// health / BAND_HEALTH, and is drawn over every visible damaged cell rather
// than only the one being cut.
//
// Automated validation: pose two cells at different healths, read the drawn
// frame over each and hold them different and both drawn.
//
// `test-case.toml` declares this suite as `assets/crack-follows-damage.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (damage (image)) around the drive.

import { test } from "vitest";

test("The crack drawn on a cell follows its damage", () => {
  throw new Error(
    "Deepcore validator `assets/crack-follows-damage` is declared in test-case.toml but has not been authored yet.",
  );
});
