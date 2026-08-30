// Deepcore — assets.gas-seep-round-robin. STUB: NOT YET AUTHORED.
//
// Every visible gas pocket wisps in turn
//
// The gas-seep system is emitted over the gas pockets currently on screen in
// round-robin turn, so every visible pocket wisps within GAS_SEEP_PERIOD (2)
// seconds and a player watching a suspect cell sees it breathe.
//
// Automated validation: pose several gas pockets in view, advance
// GAS_SEEP_PERIOD and hold at least one seep emitted over each of them.
//
// `test-case.toml` declares this suite as `assets/gas-seep-round-robin.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (seep (replay)) around the drive.

import { test } from "vitest";

test("Every visible gas pocket wisps in turn", () => {
  throw new Error(
    "Deepcore validator `assets/gas-seep-round-robin` is declared in test-case.toml but has not been authored yet.",
  );
});
