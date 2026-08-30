// Deepcore — modes.hardcore-continue-resumes-in-progress. STUB: NOT YET AUTHORED.
//
// A Hardcore save still resumes an expedition in progress
//
// CONTINUE on the title screen resumes a Hardcore save that was never died on,
// so the mode deletes the save on death without disabling saving.
//
// Automated validation: save in Hardcore, return to the title without dying,
// continue and read the expedition resumed.
//
// `test-case.toml` declares this suite as `modes/hardcore-continue-resumes-in-progress.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (resume (image)) around the drive.

import { test } from "vitest";

test("A Hardcore save still resumes an expedition in progress", () => {
  throw new Error(
    "Deepcore validator `modes/hardcore-continue-resumes-in-progress` is declared in test-case.toml but has not been authored yet.",
  );
});
