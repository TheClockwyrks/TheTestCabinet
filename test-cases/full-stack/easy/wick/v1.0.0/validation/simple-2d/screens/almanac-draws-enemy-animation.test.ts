// screens/almanac-draws-enemy-animation — the ENEMIES tab animates its
// highlighted enemy.
//
// WHAT THIS DECIDES. One thing: the picture the entry draws MOVES while the
// almanac sits still, so the enemy's walk sheet the frame paints
// `WALK_FRAME_TIME` after one frame is not the sheet frame that frame painted.
// What the picture holds, and which frame of the sheet is due when, are not
// read here: this point is the DIFFERENCE between two frames.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`, the picture-and-stats table): "`ENEMIES` | the
//   enemy's walk sheet, animated at `WALK_FRAME_TIME`".
//   specs/ui.md (`almanac`, the parts table): "Picture | The produced sprite
//   the table below names, animated where that sprite is a sheet."
//   specs/ui.md (`almanac`): "The almanac holds the idle run, nothing advances
//   while it is open", so the picture moves on a screen whose run does not.
//   specs/assets.md (The sprites): "Each common enemy, a walk cycle |
//   `assets/sprites/enemies/<id>/0.png` to `3.png`", which is how a blit is
//   attributed to the sheet whatever frame of it was painted.
//   specs/assets.md (Animation): `WALK_FRAME_TIME` is `0.1` seconds.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, then two `ArrowRight`
// presses to reach the enemies tab through the screen's own key, which leaves
// `menuIndex` at `0`. One frame is drawn and the files it painted under the
// entry's sheet directory are kept; `WALK_FRAME_TIME` of further frames run,
// and the files the last of them painted are kept. Each frame of this harness's
// constant clock is `TICK_DT`, so `round(WALK_FRAME_TIME × TICK_HZ)` frames is
// exactly `WALK_FRAME_TIME` of time.
//
// THE TOLERANCE. None, and none is needed: a sheet advanced at
// `WALK_FRAME_TIME` shows `floor(t / WALK_FRAME_TIME) mod 4`, and that index
// differs between any two moments exactly `WALK_FRAME_TIME` apart whatever
// phase the build started from, so the two readings differ for every conformant
// build and agree for a build that painted one frame of the sheet forever.
// Which files the two frames hold is not asserted, only that they differ.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotDeepEqual } from "../assert";
import {
  ENEMY_IDS,
  ENEMY_SHEET_DIR,
  WALK_FRAME_TIME,
  ticksFor,
} from "../constants";
import {
  blitsOf,
  blitsUnderDir,
  captureReplay,
  createHarness,
  poseScene,
  type DrawCall,
  type Harness,
} from "../harness";
import { tabIndex, walkToTab } from "./almanac";

let h: Harness;

/** The enemies tab's first entry, and the directory its walk sheet lives in. */
const ENEMY = ENEMY_IDS[0];
const SHEET_DIR = `${ENEMY_SHEET_DIR}/${ENEMY}`;

/** Frames of the harness's clock that cover WALK_FRAME_TIME: six. */
const FRAMES = ticksFor(WALK_FRAME_TIME);

/** The files a frame painted from the entry's walk sheet, in the order painted. */
function sheetFiles(calls: readonly DrawCall[]): string[] {
  return blitsUnderDir(blitsOf(calls), SHEET_DIR).map((blit) => blit.id);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("paints a different frame of the walk sheet WALK_FRAME_TIME later", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the frames are drawn on");

  const staged = await walkToTab(h, "ENEMIES");
  assertEqual(
    staged.almanacTab,
    tabIndex("ENEMIES"),
    "the tab the picture is read on",
  );
  assertEqual(staged.menuIndex, 0, "the entry the picture is read for");

  const drawn = await captureReplay(h, "animation", async () => {
    await h.frameDraw();
    const before = sheetFiles(h.lastCalls());
    await h.tick(FRAMES);
    return { before, after: sheetFiles(h.lastCalls()) };
  });

  assertGreaterThan(
    drawn.before.length,
    0,
    `blits of ${SHEET_DIR} on the first frame, the picture the entry draws`,
  );
  assertNotDeepEqual(
    drawn.after,
    drawn.before,
    `the walk sheet frames painted ${WALK_FRAME_TIME} seconds apart`,
  );
});
