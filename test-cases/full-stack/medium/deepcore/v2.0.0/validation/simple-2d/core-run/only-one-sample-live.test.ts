// Deepcore — core-run.only-one-sample-live. STUB: NOT YET AUTHORED.
//
// Only one Sample may be live at a time
//
// With a Sample already carried or already ticking on the ground, a second
// extraction is refused and nothing changes, so two timers never run at once.
//
// Automated validation: pose a carried Sample, attempt a second extraction and
// read the satchel and the timer unchanged, then repeat with one jettisoned.
//
// `test-case.toml` declares this suite as `core-run/only-one-sample-live.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (single (replay)) around the drive.

import { test } from "vitest";

test("Only one Sample may be live at a time", () => {
  throw new Error(
    "Deepcore validator `core-run/only-one-sample-live` is declared in test-case.toml but has not been authored yet.",
  );
});
