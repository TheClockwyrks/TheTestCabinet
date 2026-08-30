// Deepcore — movement.terminal-speed-empty. STUB: NOT YET AUTHORED.
//
// An empty fall caps at the empty terminal speed
//
// An empty miner falling freely reaches FALL_TERMINAL_EMPTY (950) units per
// second and goes no faster however far it falls.
//
// Automated validation: clear a deep shaft, drop the miner with an empty bay
// for long enough to reach terminal, and hold the downward velocity at
// FALL_TERMINAL_EMPTY.
//
// `test-case.toml` declares this suite as `movement/terminal-speed-empty.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (terminal (replay)) around the drive.

import { test } from "vitest";

test("An empty fall caps at the empty terminal speed", () => {
  throw new Error(
    "Deepcore validator `movement/terminal-speed-empty` is declared in test-case.toml but has not been authored yet.",
  );
});
