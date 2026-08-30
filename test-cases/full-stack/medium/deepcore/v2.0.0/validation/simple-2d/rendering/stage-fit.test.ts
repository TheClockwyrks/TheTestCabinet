// Deepcore — rendering.stage-fit. STUB: NOT YET AUTHORED.
//
// The stage is fitted and centered
//
// Over surfaces wider than the stage, taller than it, and at a raised device
// pixel ratio, the whole stage is inside the surface at its own aspect ratio,
// centered with even letterboxing.
//
// Automated validation: size the surface wider, taller and at a raised ratio
// in turn and hold the drawn stage extent, aspect and centering at each.
//
// `test-case.toml` declares this suite as `rendering/stage-fit.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (fit (image)) around the drive.

import { test } from "vitest";

test("The stage is fitted and centered", () => {
  throw new Error(
    "Deepcore validator `rendering/stage-fit` is declared in test-case.toml but has not been authored yet.",
  );
});
