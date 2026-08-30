// Deepcore — hazards.lava-does-not-spread. STUB: NOT YET AUTHORED.
//
// Lava neither flows nor spreads
//
// Lava stays in the cells it was generated in: over a long span no
// neighbouring cell becomes lava and no lava cell empties, so a route around a
// pool can be planned.
//
// Automated validation: record a posed pool and its neighbourhood, advance a
// long span and read every cell unchanged.
//
// `test-case.toml` declares this suite as `hazards/lava-does-not-spread.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (still (replay)) around the drive.

import { test } from "vitest";

test("Lava neither flows nor spreads", () => {
  throw new Error(
    "Deepcore validator `hazards/lava-does-not-spread` is declared in test-case.toml but has not been authored yet.",
  );
});
