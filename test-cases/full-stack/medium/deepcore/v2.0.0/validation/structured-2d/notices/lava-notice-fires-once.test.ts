// Deepcore — notices.lava-notice-fires-once. STUB: NOT YET AUTHORED.
//
// The first lava burn raises a card, and only the first
//
// The first lava burn that damages the miner in an expedition raises the lava
// notice card, and no later burn raises it again.
//
// Automated validation: burn the miner on two posed lava cells in one
// expedition and read the notice raised on the first and noticesFired.lava
// already true before the second.
//
// `test-case.toml` declares this suite as `notices/lava-notice-fires-once.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (card (replay)) around the drive.

import { test } from "vitest";

test("The first lava burn raises a card, and only the first", () => {
  throw new Error(
    "Deepcore validator `notices/lava-notice-fires-once` is declared in test-case.toml but has not been authored yet.",
  );
});
