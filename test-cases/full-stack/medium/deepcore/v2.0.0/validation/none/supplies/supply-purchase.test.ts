// Deepcore — supplies.supply-purchase. STUB: NOT YET AUTHORED.
//
// Buying a supply deducts its price and adds one
//
// Buying a field supply at the Supply Depot deducts its price and increments
// its held count by one, at the prices in specs/items.md.
//
// Automated validation: buy each of the six from a known balance and hold each
// deduction and each count against the table.
//
// `test-case.toml` declares this suite as `supplies/supply-purchase.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (depot (image)) around the drive.

import { test } from "vitest";

test("Buying a supply deducts its price and adds one", () => {
  throw new Error(
    "Deepcore validator `supplies/supply-purchase` is declared in test-case.toml but has not been authored yet.",
  );
});
