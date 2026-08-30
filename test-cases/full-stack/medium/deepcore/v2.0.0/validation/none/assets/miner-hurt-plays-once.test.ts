// Deepcore — assets.miner-hurt-plays-once. STUB: NOT YET AUTHORED.
//
// The hurt cycle plays once rather than looping
//
// The hurt cycle plays once and then gives way to whatever the miner is doing
// after HURT_TIME (0.4) seconds, rather than looping while the state holds.
//
// Automated validation: damage the miner, sample the drawn frame across
// HURT_TIME and hold the cycle running once before the state gives way.
//
// `test-case.toml` declares this suite as `assets/miner-hurt-plays-once.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (flinch (replay)) around the drive.

import { test } from "vitest";

test("The hurt cycle plays once rather than looping", () => {
  throw new Error(
    "Deepcore validator `assets/miner-hurt-plays-once` is declared in test-case.toml but has not been authored yet.",
  );
});
