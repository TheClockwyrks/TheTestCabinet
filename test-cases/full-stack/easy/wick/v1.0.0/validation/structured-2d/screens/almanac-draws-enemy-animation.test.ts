// Wick — screens/almanac-draws-enemy-animation: the `ENEMIES` tab's picture
// plays, one walk frame per `WALK_FRAME_TIME`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`", gives
// the entry's Picture as "The produced sprite the table below names, animated
// where that sprite is a sheet", and the table gives `ENEMIES` "the enemy's
// walk sheet, animated at `WALK_FRAME_TIME`". `specs/assets.md` fixes
// `WALK_FRAME_TIME` at `0.1` seconds and puts each enemy's cycle under
// `assets/sprites/enemies/<id>/`, `ENEMY_FRAMES` (`4`) files.
//
// WHAT IS READ. The PICTURE the frame last laid down from that sheet, as the
// bytes of the produced file it came from, on two frames `WALK_FRAME_TIME`
// apart. Bytes rather than a file name, because two frames of a sheet holding
// one drawing are one picture to a player. Which frame of the cycle the
// almanac starts on is the build's, so nothing about the cycle's phase is
// read: what is read is that the picture the reader sees CHANGED over one
// frame time, which is what "animated at `WALK_FRAME_TIME`" fixes and what a
// picture standing still fails.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, and two
// `ArrowRight` presses onto the third tab, which "set[s] `menuIndex` and
// `almanacScroll` to `0`", so the entry shown is the Moth. One frame is read,
// then a single frame worth exactly `WALK_FRAME_TIME` of delta —
// `specs/instrumentation.md` lets a scenario hand a frame any delta, and
// nothing on this screen ticks, so the whole of that delta is the animation's.
//
// WHICH CLOCK IT RUNS ON. `specs/ui.md`, "`almanac`": "Its entry picture is
// the exception: a picture drawn from a sheet is animated off `simTime`, which
// every frame advances whatever the screen, so the ENEMIES tab's walk sheet
// steps one frame per `WALK_FRAME_TIME` of frame time while the run itself
// stands still." So the run standing at its idle tick is no answer here: one
// frame of `WALK_FRAME_TIME` moves the picture on whether or not a tick does.
//
// THE TOLERANCE. The gap is exactly `WALK_FRAME_TIME`, the figure the
// specification animates the sheet at, and the reading is an equality of
// bytes. A cycle stepping once per `WALK_FRAME_TIME` has moved on by exactly
// one frame across that gap; a cycle stepping more slowly has not, which is
// the failure this point is for.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import {
  ALMANAC_TABS,
  ENEMY_FRAMES,
  WALK_FRAME_TIME,
  assetFile,
  enemyFrame,
} from "../constants";
import {
  blitsOf,
  captureReplay,
  createHarness,
  poseScreen,
  type Harness,
} from "../harness";
import { moveTab, pictureBytes } from "./almanac";

/** The entry shown: the first of the enemies tab, the Moth, and its four frames. */
const ENTRY = "moth";
const AT = ALMANAC_TABS.indexOf("ENEMIES");
const SHEET: readonly string[] = Array.from({ length: ENEMY_FRAMES }, (_, at) =>
  assetFile(enemyFrame(ENTRY, at)),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws a different frame of the Moth's sheet WALK_FRAME_TIME later", async () => {
  h.reset();
  poseScreen(h, "almanac");

  const pictures = await captureReplay(h, "animation", async () => {
    const shown = await moveTab(h, AT);
    assertEqual(shown.almanacTab, AT, "the tab the almanac is showing");
    assertEqual(shown.menuIndex, 0, "the entry the detail pane shows");

    const { blits } = await h.frameDraw();
    const first = pictureBytes(blits, SHEET);
    await h.frameOf(WALK_FRAME_TIME * 1000);
    const second = pictureBytes(blitsOf(h.lastCalls()), SHEET);
    return { first, second };
  });

  assertNotNull(
    pictures.first,
    `a frame of the Moth's produced walk sheet on the first frame (specs/ui.md, almanac)`,
  );
  assertNotNull(
    pictures.second,
    `a frame of the Moth's produced walk sheet ${WALK_FRAME_TIME}s later (specs/ui.md, almanac)`,
  );
  assertTrue(
    !(pictures.first as Buffer).equals(pictures.second as Buffer),
    `the picture drawn ${WALK_FRAME_TIME}s later differs from the one before it, the walk sheet animated at WALK_FRAME_TIME (specs/ui.md, almanac)`,
  );
});
