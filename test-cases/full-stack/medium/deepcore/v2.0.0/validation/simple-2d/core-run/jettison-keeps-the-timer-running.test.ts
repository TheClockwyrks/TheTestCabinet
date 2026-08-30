// Deepcore — core-run.jettison-keeps-the-timer-running. STUB: NOT YET AUTHORED.
//
// Jettisoning neither pauses nor resets the timer
//
// Jettisoning drops the Sample onto the miner cell as a ground item and the
// destabilization timer keeps running unchanged across the drop.
//
// Automated validation: pose a carried Sample at a known timer, jettison and
// read the timer continuing from where it stood with coreGround set to the
// miner cell.
//
// `test-case.toml` declares this suite as `core-run/jettison-keeps-the-timer-running.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (drop (replay)) around the drive.

import { test } from "vitest";

test("Jettisoning neither pauses nor resets the timer", () => {
  throw new Error(
    "Deepcore validator `core-run/jettison-keeps-the-timer-running` is declared in test-case.toml but has not been authored yet.",
  );
});
