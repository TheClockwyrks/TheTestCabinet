// Deepcore — notices.notice-is-non-blocking. STUB: NOT YET AUTHORED.
//
// The mine keeps running behind the card
//
// The card is non-blocking: the simulation carries on behind it, so the miner
// still falls, still drills and still burns fuel while it is on screen.
//
// Automated validation: raise a notice, then drive a fall and a cut while it
// is shown and read both taking effect.
//
// `test-case.toml` declares this suite as `notices/notice-is-non-blocking.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (behind (replay)) around the drive.

import { test } from "vitest";

test("The mine keeps running behind the card", () => {
  throw new Error(
    "Deepcore validator `notices/notice-is-non-blocking` is declared in test-case.toml but has not been authored yet.",
  );
});
