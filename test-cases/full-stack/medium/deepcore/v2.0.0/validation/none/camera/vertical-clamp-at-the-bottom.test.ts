// Deepcore — camera.vertical-clamp-at-the-bottom. STUB: NOT YET AUTHORED.
//
// The camera stops above the Core chamber
//
// camY is clamped to (coreRow + 1) * TILE - VIEW_H, so the view stops with the
// Core chamber at the foot of the screen rather than scrolling into the
// bedrock below it.
//
// Automated validation: pose the miner in the Core chamber and hold camera.y
// at the clamp.
//
// `test-case.toml` declares this suite as `camera/vertical-clamp-at-the-bottom.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (bottom (image)) around the drive.

import { test } from "vitest";

test("The camera stops above the Core chamber", () => {
  throw new Error(
    "Deepcore validator `camera/vertical-clamp-at-the-bottom` is declared in test-case.toml but has not been authored yet.",
  );
});
