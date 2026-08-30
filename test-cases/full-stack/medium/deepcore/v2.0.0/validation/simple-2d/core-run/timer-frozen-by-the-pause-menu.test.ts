// Deepcore — core-run.timer-frozen-by-the-pause-menu. STUB: NOT YET AUTHORED.
//
// The pause menu freezes the timer
//
// The pause menu freezes the whole simulation, the Core Sample timer with it,
// and resuming resumes it where it stopped.
//
// Automated validation: pose a carried Sample, pause, advance a span, read the
// timer unchanged, resume and read it falling again.
//
// `test-case.toml` declares this suite as `core-run/timer-frozen-by-the-pause-menu.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (frozen (replay)) around the drive.

import { test } from "vitest";

test("The pause menu freezes the timer", () => {
  throw new Error(
    "Deepcore validator `core-run/timer-frozen-by-the-pause-menu` is declared in test-case.toml but has not been authored yet.",
  );
});
