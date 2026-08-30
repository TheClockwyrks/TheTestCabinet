// Deepcore — save.save-excludes-a-live-sample. STUB: NOT YET AUTHORED.
//
// A live Core Sample is never carried in the save
//
// Because saving is refused while a Sample is live, no save ever holds one: a
// restored expedition always begins with coreTimer null.
//
// Automated validation: save cleanly, extract a Sample, die, continue and read
// coreTimer null on the restored expedition.
//
// `test-case.toml` declares this suite as `save/save-excludes-a-live-sample.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (clean (image)) around the drive.

import { test } from "vitest";

test("A live Core Sample is never carried in the save", () => {
  throw new Error(
    "Deepcore validator `save/save-excludes-a-live-sample` is declared in test-case.toml but has not been authored yet.",
  );
});
