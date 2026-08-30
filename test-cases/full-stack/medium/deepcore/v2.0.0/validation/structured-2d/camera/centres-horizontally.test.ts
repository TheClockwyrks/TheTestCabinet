// Deepcore — camera.centres-horizontally. STUB: NOT YET AUTHORED.
//
// The camera centres the miner horizontally
//
// camX is clamp(mx - VIEW_W / 2, 0, WORLD_W - VIEW_W), so the miner sits on
// the horizontal centre of the viewport wherever the clamp allows it.
//
// Automated validation: pose the miner at several columns in the middle of the
// world and hold camera.x against the formula at each.
//
// `test-case.toml` declares this suite as `camera/centres-horizontally.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (centre (image)) around the drive.

import { test } from "vitest";

test("The camera centres the miner horizontally", () => {
  throw new Error(
    "Deepcore validator `camera/centres-horizontally` is declared in test-case.toml but has not been authored yet.",
  );
});
