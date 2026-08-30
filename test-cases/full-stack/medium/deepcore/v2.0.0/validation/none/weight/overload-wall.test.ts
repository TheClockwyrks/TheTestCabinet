// Deepcore — weight.overload-wall. STUB: NOT YET AUTHORED.
//
// An overloaded miner cannot climb
//
// At a load fraction of 1 or more the climb acceleration is 0: holding thrust
// arrests the fall and produces no climb at all, so the miner cannot lift off.
//
// Automated validation: pose the cargo at the lift limit in a cleared shaft,
// hold thrust for a sustained span and hold the height reached at or below
// where it started.
//
// `test-case.toml` declares this suite as `weight/overload-wall.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (overload (replay)) around the drive.

import { test } from "vitest";

test("An overloaded miner cannot climb", () => {
  throw new Error(
    "Deepcore validator `weight/overload-wall` is declared in test-case.toml but has not been authored yet.",
  );
});
