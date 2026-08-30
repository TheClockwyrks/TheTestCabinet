// Deepcore — economy.fill-pays-only-for-what-is-missing. STUB: NOT YET AUTHORED.
//
// Filling to full pays only for the missing fuel
//
// Fill-to-full charges FUEL_PRICE for each unit the tank is short and no more,
// so filling a tank at 40 of 100 costs 60 Credits.
//
// Automated validation: pose a part-empty tank with ample Credits, fill to
// full and hold the Credits spent against the shortfall.
//
// `test-case.toml` declares this suite as `economy/fill-pays-only-for-what-is-missing.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (fill (image)) around the drive.

import { test } from "vitest";

test("Filling to full pays only for the missing fuel", () => {
  throw new Error(
    "Deepcore validator `economy/fill-pays-only-for-what-is-missing` is declared in test-case.toml but has not been authored yet.",
  );
});
