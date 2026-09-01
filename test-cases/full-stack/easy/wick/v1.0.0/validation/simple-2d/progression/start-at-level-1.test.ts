// progression/start-at-level-1 — a run begins at level 1 with no experience, no
// kills, and no level-up queued.
//
// THE FIGURES, FROM THE SPEC. specs/progression.md, Slots: "A run starts with
// Taper at level 1 in the first weapon slot, every other slot empty, level 1,
// and xp 0." Levels and experience: "level starts at 1 and xp is a real number
// that starts at 0", and the threshold at level 1 is XP_BASE (5) by the same
// section's formula. specs/state.md's idle run is what a fresh run is built
// from, so kills and pendingLevelUps stand at 0.
//
// THE POSE. A reset, then setScreen("playing"), which from the title "Begins a
// fresh run exactly as LIGHT THE LAMP and TRY AGAIN do"
// (specs/instrumentation.md). Nothing else is posed and no tick is run, so what
// the snapshot reports is the run as it was begun. The frame drawn afterwards
// is the picture kept as evidence; the reading was taken before it.
//
// THE TOLERANCE. FIGURE_TOLERANCE on xp, a real number; the level, the
// threshold, the kill count, and the queue are whole counts read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, XP_BASE } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads level 1, xp 0, xpToNext 5, kills 0, and pendingLevelUps 0 on a fresh run", async () => {
  h.reset();
  h.debug.setScreen("playing");
  const start = h.snapshot();

  await h.frameDraw();
  captureStill(h, "start");

  assertEqual(start.screen, "playing", "the screen a fresh run begins on");
  assertEqual(start.run.level, 1, "the level a run starts at");
  assertWithin(
    start.run.xp,
    0,
    FIGURE_TOLERANCE,
    "the experience it starts with",
  );
  assertEqual(start.run.xpToNext, XP_BASE, "the first level's threshold");
  assertEqual(start.run.kills, 0, "the kills it starts with");
  assertEqual(start.run.pendingLevelUps, 0, "the level-ups it starts queued");
});
