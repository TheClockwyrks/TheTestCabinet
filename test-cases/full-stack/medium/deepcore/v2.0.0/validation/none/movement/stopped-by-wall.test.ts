// Deepcore — movement.stopped-by-wall. STUB: NOT YET AUTHORED.
//
// A walk into a wall stops at its face
//
// Walking into a solid cell stops the miner with its box flush against that
// cell rather than passing through it or standing off it, whatever the drill
// is doing.
//
// Automated validation: clear a corridor ending in a posed solid cell, hold
// right with the drill off until the miner stops, and hold the resting box
// edge against the cell face.
//
// `test-case.toml` declares this suite as `movement/stopped-by-wall.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (wall (replay)) around the drive.

import { test } from "vitest";

test("A walk into a wall stops at its face", () => {
  throw new Error(
    "Deepcore validator `movement/stopped-by-wall` is declared in test-case.toml but has not been authored yet.",
  );
});
