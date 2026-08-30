// Deepcore — assets.miner-mirrors. STUB: NOT YET AUTHORED.
//
// The miner mirrors to face the other way
//
// The miner is drawn from one canonical facing and mirrored to face the other,
// so the same state drawn facing east and facing west is the same image
// reflected rather than a second, different drawing.
//
// Automated validation: draw the miner in one state at each facing and hold
// one frame against the horizontal mirror of the other.
//
// `test-case.toml` declares this suite as `assets/miner-mirrors.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (mirror (image)) around the drive.

import { test } from "vitest";

test("The miner mirrors to face the other way", () => {
  throw new Error(
    "Deepcore validator `assets/miner-mirrors` is declared in test-case.toml but has not been authored yet.",
  );
});
