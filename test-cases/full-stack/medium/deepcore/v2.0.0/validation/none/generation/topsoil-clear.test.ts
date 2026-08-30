// Deepcore — generation.topsoil-clear. STUB: NOT YET AUTHORED.
//
// The topsoil holds no hazard and no boulder
//
// The topsoil band holds only rock and ore: no gas pocket, no lava cell and no
// unbreakable stone appears above the rockbed, so the first band is safe to
// learn in.
//
// Automated validation: generate mines at several seeds and read every topsoil
// cell, holding each kind against gas, lava and stone.
//
// `test-case.toml` declares this suite as `generation/topsoil-clear.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (topsoil (image)) around the drive.

import { test } from "vitest";

test("The topsoil holds no hazard and no boulder", () => {
  throw new Error(
    "Deepcore validator `generation/topsoil-clear` is declared in test-case.toml but has not been authored yet.",
  );
});
