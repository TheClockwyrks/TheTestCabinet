// Deepcore — movement.facing-follows-input. STUB: NOT YET AUTHORED.
//
// The miner faces the way it last moved
//
// The miner facing follows the last lateral action held, reading west after
// left and east after right, and it holds that facing when the action is
// released.
//
// Automated validation: hold left, read the facing, release, hold right, read
// it again, and confirm the facing holds after release.
//
// `test-case.toml` declares this suite as `movement/facing-follows-input.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (facing (replay)) around the drive.

import { test } from "vitest";

test("The miner faces the way it last moved", () => {
  throw new Error(
    "Deepcore validator `movement/facing-follows-input` is declared in test-case.toml but has not been authored yet.",
  );
});
