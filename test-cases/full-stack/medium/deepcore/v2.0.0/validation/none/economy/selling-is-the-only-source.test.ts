// Deepcore — economy.selling-is-the-only-source. STUB: NOT YET AUTHORED.
//
// Credits rise only at the Ore Market
//
// Nothing but a sale adds Credits: mining, refuelling, using a field supply,
// dying and launching all leave the balance where it stood or lower it.
//
// Automated validation: pose a balance, drive a cut, a refuel, an item use and
// a death in turn and read the balance never rising outside a sale.
//
// `test-case.toml` declares this suite as `economy/selling-is-the-only-source.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (balance (replay)) around the drive.

import { test } from "vitest";

test("Credits rise only at the Ore Market", () => {
  throw new Error(
    "Deepcore validator `economy/selling-is-the-only-source` is declared in test-case.toml but has not been authored yet.",
  );
});
