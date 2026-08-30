// Deepcore — generation.lava-none-above-the-deepstone. STUB: NOT YET AUTHORED.
//
// No lava appears above the deepstone
//
// The topsoil and rockbed bands hold no lava cell at any seed, so lava is
// first met at the deepstone as specs/world.md states.
//
// Automated validation: generate mines at several seeds and read every cell of
// the topsoil and rockbed bands, holding each kind against lava.
//
// `test-case.toml` declares this suite as `generation/lava-none-above-the-deepstone.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (upper (image)) around the drive.

import { test } from "vitest";

test("No lava appears above the deepstone", () => {
  throw new Error(
    "Deepcore validator `generation/lava-none-above-the-deepstone` is declared in test-case.toml but has not been authored yet.",
  );
});
