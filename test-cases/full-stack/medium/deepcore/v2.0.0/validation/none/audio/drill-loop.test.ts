// Deepcore — audio.drill-loop. STUB: NOT YET AUTHORED.
//
// The drill cue loops while cutting
//
// The drill cue plays while the miner is cutting and stops when the cut stops,
// so a held dig is audible for as long as it runs.
//
// Automated validation: hold a cut on a posed cell and observe the drill cue
// played, then release and observe it stopped.
//
// `test-case.toml` declares this suite as `audio/drill-loop.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (drill (replay)) around the drive.

import { test } from "vitest";

test("The drill cue loops while cutting", () => {
  throw new Error(
    "Deepcore validator `audio/drill-loop` is declared in test-case.toml but has not been authored yet.",
  );
});
