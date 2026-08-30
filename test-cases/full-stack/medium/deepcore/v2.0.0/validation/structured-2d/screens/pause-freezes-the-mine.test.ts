// Deepcore — screens.pause-freezes-the-mine. STUB: NOT YET AUTHORED.
//
// The pause menu freezes the world
//
// pause during play opens the pause menu over the frozen, dimmed world: the
// simulation stops, so the miner does not fall and no fuel is spent while it
// is open.
//
// Automated validation: pose the miner falling, pause, advance a span and read
// the position, velocity and fuel unchanged.
//
// `test-case.toml` declares this suite as `screens/pause-freezes-the-mine.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (frozen (replay)) around the drive.

import { test } from "vitest";

test("The pause menu freezes the world", () => {
  throw new Error(
    "Deepcore validator `screens/pause-freezes-the-mine` is declared in test-case.toml but has not been authored yet.",
  );
});
