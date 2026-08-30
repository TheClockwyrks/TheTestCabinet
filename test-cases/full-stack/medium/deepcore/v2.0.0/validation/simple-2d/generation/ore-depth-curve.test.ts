// Deepcore — generation.ore-depth-curve. STUB: NOT YET AUTHORED.
//
// The ore a vein holds is drawn from its depth curve
//
// Every ore found at depth fraction f is one whose curve is open there, so
// abs(f - peak) is under spread for that ore, and a deep vein therefore never
// holds Ferron while a shallow one never holds Cindrite.
//
// Automated validation: generate a mine, read the ore of every ore cell with
// its row, and hold each ore against the peak and spread specs/mining.md
// states for it at that cell depth fraction.
//
// `test-case.toml` declares this suite as `generation/ore-depth-curve.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (mix (image)) around the drive.

import { test } from "vitest";

test("The ore a vein holds is drawn from its depth curve", () => {
  throw new Error(
    "Deepcore validator `generation/ore-depth-curve` is declared in test-case.toml but has not been authored yet.",
  );
});
