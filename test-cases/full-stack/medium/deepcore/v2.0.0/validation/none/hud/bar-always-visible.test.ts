// Deepcore — hud.bar-always-visible. STUB: NOT YET AUTHORED.
//
// The status bar is fully visible while mining
//
// The status bar occupies y in [0, HUD_H] and is fully visible for the whole
// of in-mine, at the surface and at the bottom of the mine alike, so the world
// never draws over it.
//
// Automated validation: read the drawn frame inside the status bar band with
// the miner at the camp and deep underground and hold the bar drawn and
// unobscured at both.
//
// `test-case.toml` declares this suite as `hud/bar-always-visible.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (bar (image)) around the drive.

import { test } from "vitest";

test("The status bar is fully visible while mining", () => {
  throw new Error(
    "Deepcore validator `hud/bar-always-visible` is declared in test-case.toml but has not been authored yet.",
  );
});
