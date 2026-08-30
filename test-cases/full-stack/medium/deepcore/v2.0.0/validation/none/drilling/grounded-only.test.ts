// Deepcore — drilling.grounded-only. STUB: NOT YET AUTHORED.
//
// A miner off the ground starts no cut
//
// A cut starts only while the miner rests on a solid cell: a falling,
// thrusting or hovering miner cuts nothing whichever direction is held, so a
// plunge down a shaft never side-drills the walls it passes.
//
// Automated validation: drop the miner down a cleared shaft with a drill
// direction held and read every cell it passes unchanged, then repeat while
// holding thrust.
//
// `test-case.toml` declares this suite as `drilling/grounded-only.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (airborne (replay)) around the drive.

import { test } from "vitest";

test("A miner off the ground starts no cut", () => {
  throw new Error(
    "Deepcore validator `drilling/grounded-only` is declared in test-case.toml but has not been authored yet.",
  );
});
