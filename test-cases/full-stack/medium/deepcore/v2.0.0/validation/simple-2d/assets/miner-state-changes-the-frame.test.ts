// Deepcore — assets.miner-state-changes-the-frame. STUB: NOT YET AUTHORED.
//
// The drawn miner changes when its state does
//
// The miner drawn in one animation state differs from the miner drawn in
// another at the same position and facing, so a build that plays one cycle for
// everything fails here: idle, walk, drill-down, jetpack and fall each draw
// differently.
//
// Automated validation: pose the miner into each state in turn at one position
// and facing and hold every pair of drawn frames different.
//
// `test-case.toml` declares this suite as `assets/miner-state-changes-the-frame.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (states (image)) around the drive.

import { test } from "vitest";

test("The drawn miner changes when its state does", () => {
  throw new Error(
    "Deepcore validator `assets/miner-state-changes-the-frame` is declared in test-case.toml but has not been authored yet.",
  );
});
