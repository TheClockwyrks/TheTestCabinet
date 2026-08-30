// Deepcore — hud.overload-readout. STUB: NOT YET AUTHORED.
//
// The status bar reads OVERLOAD while the load is over the limit
//
// The status bar reads OVERLOAD while the load fraction is 1 or more, so a
// miner that cannot climb is told so before it tries.
//
// Automated validation: pose the cargo either side of the lift limit and read
// the drawn status bar for the OVERLOAD text at the overloaded one alone.
//
// `test-case.toml` declares this suite as `hud/overload-readout.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (overload (image)) around the drive.

import { test } from "vitest";

test("The status bar reads OVERLOAD while the load is over the limit", () => {
  throw new Error(
    "Deepcore validator `hud/overload-readout` is declared in test-case.toml but has not been authored yet.",
  );
});
