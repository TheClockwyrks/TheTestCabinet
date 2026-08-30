// Deepcore — core-run.jettisoned-sample-cannot-be-recovered. STUB: NOT YET AUTHORED.
//
// A jettisoned Sample cannot be picked back up
//
// Walking over a jettisoned Sample does nothing: it stays on its cell and
// never returns to the satchel.
//
// Automated validation: jettison a Sample, walk the miner over its cell and
// read the satchel still empty and coreGround still set.
//
// `test-case.toml` declares this suite as `core-run/jettisoned-sample-cannot-be-recovered.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (pass (replay)) around the drive.

import { test } from "vitest";

test("A jettisoned Sample cannot be picked back up", () => {
  throw new Error(
    "Deepcore validator `core-run/jettisoned-sample-cannot-be-recovered` is declared in test-case.toml but has not been authored yet.",
  );
});
