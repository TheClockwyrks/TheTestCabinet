// Deepcore — materials.material-not-sold. STUB: NOT YET AUTHORED.
//
// Materials are never sold
//
// An Ore Market sale leaves the satchel untouched, so materials cannot be
// converted to Credits by accident.
//
// Automated validation: pose materials and cargo, sell, and read the satchel
// unchanged while the bay empties.
//
// `test-case.toml` declares this suite as `materials/material-not-sold.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (sale (image)) around the drive.

import { test } from "vitest";

test("Materials are never sold", () => {
  throw new Error(
    "Deepcore validator `materials/material-not-sold` is declared in test-case.toml but has not been authored yet.",
  );
});
