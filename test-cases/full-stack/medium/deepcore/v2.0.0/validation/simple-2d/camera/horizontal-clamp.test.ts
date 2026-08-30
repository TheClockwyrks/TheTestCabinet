// Deepcore — camera.horizontal-clamp. STUB: NOT YET AUTHORED.
//
// The camera stops at the edges of the world
//
// camX is clamped to 0 and WORLD_W - VIEW_W, so approaching either border
// column stops the camera rather than scrolling past the edge of the mine.
//
// Automated validation: pose the miner at both borders and hold camera.x at
// each clamp.
//
// `test-case.toml` declares this suite as `camera/horizontal-clamp.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (edge (image)) around the drive.

import { test } from "vitest";

test("The camera stops at the edges of the world", () => {
  throw new Error(
    "Deepcore validator `camera/horizontal-clamp` is declared in test-case.toml but has not been authored yet.",
  );
});
