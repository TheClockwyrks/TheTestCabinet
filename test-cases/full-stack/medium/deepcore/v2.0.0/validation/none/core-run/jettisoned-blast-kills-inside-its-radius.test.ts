// Deepcore — core-run.jettisoned-blast-kills-inside-its-radius. STUB: NOT YET AUTHORED.
//
// A jettisoned detonation kills a miner close by
//
// A detonation on the ground kills a miner whose centre is within
// CORE_BLAST_TILES (3) tiles of the ground cell centre, with the death cause
// core-detonation.
//
// Automated validation: jettison a Sample, hold the miner two tiles away with
// travel off, run the timer out and read the death.
//
// `test-case.toml` declares this suite as `core-run/jettisoned-blast-kills-inside-its-radius.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (close (replay)) around the drive.

import { test } from "vitest";

test("A jettisoned detonation kills a miner close by", () => {
  throw new Error(
    "Deepcore validator `core-run/jettisoned-blast-kills-inside-its-radius` is declared in test-case.toml but has not been authored yet.",
  );
});
