// screens/almanac-draws-enemy-animation — the highlighted enemy's picture is
// animated, and the almanac ticks nothing while it runs.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "Picture | The
// produced sprite the table below names, animated where that sprite is a
// sheet", and the tab's row of that table: "`ENEMIES` | the enemy's walk sheet,
// animated at `WALK_FRAME_TIME`". specs/assets.md fixes the sheet and the
// figure: an enemy's walk cycle is four separate files, "no two frames of one
// sheet are the same picture", and "Seconds each frame of a walk cycle or a spin
// is shown | `WALK_FRAME_TIME` | `0.1`". specs/ui.md ("What advances on each
// screen") is what lets the picture run on a screen where nothing else does:
// "`simTime` accumulates the frame's delta time on every frame, whatever the
// screen", while `almanac` advances "Nothing".
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. Which files of the Moth's walk
// sheet the frame drew, decided by each committed file's own pixels, on one
// frame and again `WALK_FRAME_TIME` later. Since no two frames of a sheet are
// the same picture, a reading that answers a different set of files was taken of
// a different picture, and one that answers the same set was taken of the same
// one. Nothing about WHICH file either reading found is asserted: a build is
// free to start its cycle wherever it likes, and only the change is fixed.
//
// WHY THE WORLD IS POSED AS IT IS. The tab is walked to `ENEMIES` with REAL
// `ArrowRight` presses through Chromium's input pipeline, one frame each, which
// specs/ui.md has "set `menuIndex` and `almanacScroll` to `0`", so the entry
// whose picture is read is the first of `ENEMY_IDS`, the Moth. The sheet is
// decoded into the page BEFORE the frames are filmed, so no frame of the reading
// is spent on it. Nothing is pressed while the two readings are taken.
//
// THE TOLERANCE. One frame of the build's loop on the gap between the two
// readings, so seven frames of `TICK_DT` are run rather than the six that carry
// `WALK_FRAME_TIME`. `0.1` is not representable in binary floating point and six
// sixtieths sum to slightly under it, so a build that accumulates its own delta
// reaches the boundary a frame late through no fault of its own; seven frames is
// `0.11666...` seconds, which advances a cycle running at `WALK_FRAME_TIME` by
// one frame or two and by neither zero nor four, so the picture differs either
// way. The identity of a file has no tolerance beyond the presentation
// category's pixel comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import {
  ENEMY_WALK_FRAMES,
  TICK_HZ,
  WALK_FRAME_TIME,
  enemyFrame,
} from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { primeSources } from "../presentation/sources";
import { openAlmanac, poseTab, sheetFramesOf, tabIndex } from "./almanac";

/** The tab and the entry this reads: the first of `ENEMY_IDS`. */
const ENEMIES_TAB = tabIndex("ENEMIES");
const ENEMY = "moth";

/** The four files of the Moth's walk sheet, frame `0` first. */
const SHEET = Array.from({ length: ENEMY_WALK_FRAMES }, (_unused, frame) =>
  enemyFrame(ENEMY, frame),
);

/** Frames of the build's loop that carry `WALK_FRAME_TIME`, and one of slack. */
const GAP_FRAMES = Math.round(WALK_FRAME_TIME * TICK_HZ) + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a different frame of the Moth's sheet WALK_FRAME_TIME later", async () => {
  await openAlmanac(h);
  const posed = await poseTab(h, ENEMIES_TAB);
  assertEqual(posed.almanacTab, ENEMIES_TAB, "the tab the picture is read on");
  assertEqual(posed.menuIndex, 0, "the entry the picture is read on");
  await primeSources(h, SHEET);

  const read = await captureReplay(h, "animation", async () => {
    await h.step(1);
    const before = await sheetFramesOf(
      h,
      await h.lastCalls(),
      SHEET,
      "the highlighted enemy's picture on the first frame",
    );
    const held = await h.step(GAP_FRAMES);
    assertEqual(
      held.screen,
      "almanac",
      "the screen the two readings are taken on",
    );
    assertEqual(held.run.tick, 0, "the run clock while the picture animates");
    const after = await sheetFramesOf(
      h,
      await h.lastCalls(),
      SHEET,
      "the highlighted enemy's picture a walk frame later",
    );
    return { before, after };
  });

  assertNotEqual(
    read.after.join(","),
    read.before.join(","),
    "the frames of the Moth's produced sheet drawn WALK_FRAME_TIME later, " +
      "which the walk cycle has moved on from (specs/ui.md)",
  );
});
