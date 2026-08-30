// Deepcore — movement.terminal-speed-loaded. STUB: NOT YET AUTHORED.
//
// A loaded fall reaches a higher terminal speed
//
// The terminal speed is FALL_TERMINAL_EMPTY + (FALL_TERMINAL_LOADED -
// FALL_TERMINAL_EMPTY) * min(1, load), so a miner at the lift limit falls at
// FALL_TERMINAL_LOADED (1600) and one at half the limit at 1275.
//
// Automated validation: pose cargo at the lift limit and at half of it in
// turn, drop the miner down a cleared shaft and hold each terminal velocity
// against the formula.
//
// `test-case.toml` declares this suite as `movement/terminal-speed-loaded.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (heavy (replay)) around the drive.

import { test } from "vitest";

test("A loaded fall reaches a higher terminal speed", () => {
  throw new Error(
    "Deepcore validator `movement/terminal-speed-loaded` is declared in test-case.toml but has not been authored yet.",
  );
});
