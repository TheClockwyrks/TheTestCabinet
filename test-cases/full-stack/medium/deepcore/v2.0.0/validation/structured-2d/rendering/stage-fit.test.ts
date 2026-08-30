// Deepcore — rendering.stage-fit. STUB: NOT YET AUTHORED.
//
// The stage is fitted and centered
//
// Over surfaces wider than the stage, taller than it, and at a raised device
// pixel ratio, the whole STAGE_W x STAGE_H (1280 x 720) stage is inside the
// surface at its own aspect ratio, centered with even letterboxing, and the
// bars carry the stage background color within an RGB distance of 25 of 441.
//
// Automated validation: size the surface wider, taller and at a raised ratio in
// turn; hold the drawn stage extent, aspect and centering at each, and sample a
// bar against the stage background the build fixes. The fit itself is the
// runtime's under an engine, but the bar color is the build's either way: it is
// the `BACKGROUND` src/game.ts exports under an engine, and the color the build
// clears to without one.
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
