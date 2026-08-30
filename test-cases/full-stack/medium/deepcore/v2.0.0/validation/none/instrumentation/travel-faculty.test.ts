// Deepcore — instrumentation.travel-faculty. STUB: NOT YET AUTHORED.
//
// With travel off the miner body holds its position
//
// setMinerTravel(false) stops the miner body moving: gravity, walking, thrust,
// knockback and collision displacement move it nowhere however long the
// scenario runs and whatever is held, while everything else carries on, so it
// still reads as grounded, still starts and holds a cut, and still spends
// drill fuel.
//
// Automated validation: hold travel off over a posed drop with movement and
// thrust held, read the position unchanged, then confirm a held down cut still
// lands hits and spends fuel.
//
// `test-case.toml` declares this suite as `instrumentation/travel-faculty.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (held (replay)) around the drive.

import { test } from "vitest";

test("With travel off the miner body holds its position", () => {
  throw new Error(
    "Deepcore validator `instrumentation/travel-faculty` is declared in test-case.toml but has not been authored yet.",
  );
});
