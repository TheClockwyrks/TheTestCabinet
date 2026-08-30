// Deepcore — panels.panel-only-at-its-building. STUB: NOT YET AUTHORED.
//
// A building panel does not open away from its building
//
// The five building panels open only while the miner stands at that building,
// so activating in open ground or at another building never opens the wrong
// panel.
//
// Automated validation: activate with the miner standing clear of every
// building and standing at a different building, and read panel null or the
// right id at each.
//
// `test-case.toml` declares this suite as `panels/panel-only-at-its-building.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (clear (replay)) around the drive.

import { test } from "vitest";

test("A building panel does not open away from its building", () => {
  throw new Error(
    "Deepcore validator `panels/panel-only-at-its-building` is declared in test-case.toml but has not been authored yet.",
  );
});
