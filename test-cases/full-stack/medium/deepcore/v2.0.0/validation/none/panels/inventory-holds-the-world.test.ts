// Deepcore — panels.inventory-holds-the-world. STUB: NOT YET AUTHORED.
//
// The world holds still behind the inventory
//
// The world holds still behind the inventory overlay: a falling miner does not
// fall and no fuel is spent while it is open, though a live Core Sample timer
// keeps running.
//
// Automated validation: pose the miner falling with a live Sample, open the
// inventory, advance a span and read the position and fuel unchanged with the
// timer fallen.
//
// `test-case.toml` declares this suite as `panels/inventory-holds-the-world.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (held (replay)) around the drive.

import { test } from "vitest";

test("The world holds still behind the inventory", () => {
  throw new Error(
    "Deepcore validator `panels/inventory-holds-the-world` is declared in test-case.toml but has not been authored yet.",
  );
});
