// Deepcore — core-run.death-destroys-the-sample. STUB: NOT YET AUTHORED.
//
// Any death destroys the Sample
//
// A death destroys a Core Sample held or ticking on the ground, so the
// expedition never resumes with one live.
//
// Automated validation: pose a carried Sample, drive a hull death and read the
// satchel and coreTimer cleared at the game-over screen.
//
// `test-case.toml` declares this suite as `core-run/death-destroys-the-sample.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (gone (replay)) around the drive.

import { test } from "vitest";

test("Any death destroys the Sample", () => {
  throw new Error(
    "Deepcore validator `core-run/death-destroys-the-sample` is declared in test-case.toml but has not been authored yet.",
  );
});
