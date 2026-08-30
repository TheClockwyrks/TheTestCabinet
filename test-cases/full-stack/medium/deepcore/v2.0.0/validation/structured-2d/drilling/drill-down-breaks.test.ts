// Deepcore — drilling.drill-down-breaks. STUB: NOT YET AUTHORED.
//
// Holding down breaks the cell below
//
// Holding down while grounded over a minable cell cuts it, and the cell
// becomes an open tunnel when its health reaches 0.
//
// Automated validation: pose a rock cell under a grounded miner, hold down
// until the cell breaks, and read tileAt back as tunnel.
//
// `test-case.toml` declares this suite as `drilling/drill-down-breaks.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (cut (replay)) around the drive.

import { test } from "vitest";

test("Holding down breaks the cell below", () => {
  throw new Error(
    "Deepcore validator `drilling/drill-down-breaks` is declared in test-case.toml but has not been authored yet.",
  );
});
