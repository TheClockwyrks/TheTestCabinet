// Deepcore — drilling.ore-banks. STUB: NOT YET AUTHORED.
//
// Breaking an ore cell banks a unit into cargo
//
// Breaking an ore cell with a free slot banks one unit of that ore into the
// cargo bay, filling one slot and adding its weight to the load.
//
// Automated validation: pose an ore cell of a known id under the miner, cut it
// through, and read the cargo count, the slots used and the load back.
//
// `test-case.toml` declares this suite as `drilling/ore-banks.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (collect (replay)) around the drive.

import { test } from "vitest";

test("Breaking an ore cell banks a unit into cargo", () => {
  throw new Error(
    "Deepcore validator `drilling/ore-banks` is declared in test-case.toml but has not been authored yet.",
  );
});
