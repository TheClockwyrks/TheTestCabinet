// Deepcore — camera.centers-horizontally. STUB: NOT YET AUTHORED.
//
// The camera centers the miner horizontally
//
// camX is clamp(mx - VIEW_W / 2, 0, WORLD_W - VIEW_W), so the miner sits on
// the horizontal center of the viewport wherever the clamp allows it.
//
// Automated validation: pose the miner at several columns in the middle of the
// world and hold camera.x against the formula at each.
//
// `test-case.toml` declares this suite as `camera/centers-horizontally.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (center (image)) around the drive.

import { test } from "vitest";

test("The camera centers the miner horizontally", () => {
  throw new Error(
    "Deepcore validator `camera/centers-horizontally` is declared in test-case.toml but has not been authored yet.",
  );
});
