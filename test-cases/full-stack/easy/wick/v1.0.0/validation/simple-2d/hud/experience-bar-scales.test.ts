// hud/experience-bar-scales — the experience bar's filled width scales with
// xp / xpToNext.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`playing`", the HUD table):
// "Experience | A bar whose filled width scales with `xp / xpToNext`, labeled
// with `LEVEL_LABEL` (`LEVEL`) and the current level". specs/progression.md
// gives `xpToNext(level) = XP_BASE + XP_STEP × (level - 1)` with `XP_BASE` `5`
// and `XP_STEP` `10`, so the run is posed at level 2, where `xpToNext` is `15`.
// The fill at xp `12` of `15` is four fifths of the full width, and the fill at
// xp `0` is nothing.
//
// THE WORLD. Three isolated `playing` runs at level 2, each posed through
// `isolate`, which resets first: nothing alive, nothing on the ground, no
// weapon and no passive held, every driver switch off. No gem exists and no
// enemy dies, so no experience is gained and the posed `xp` is the `xp` the
// frame draws; specs/instrumentation.md (`setXp`) states the same from the
// pose's side, "No level-up is derived from it: a level-up comes from the next
// gain", so the xp 15 pose stays at level 2 with a full bar.
//
// WHAT IS READ. The longest run of horizontally adjacent differing pixels
// between the xp 0 frame and the xp 15 frame, which is the bar's whole width;
// then the same reading along THAT ROW between the xp 0 frame and the xp 12
// frame, which is the part of the bar the twelve filled. Nothing else on the
// frame moves with `xp`, and a run rather than a pixel count is read for the
// reason health-bar-scales states.
//
// TOLERANCE. BAR_SHARE_TOLERANCE, a fifth of the bar's full width, which admits
// any border, rounding, or end-cap a build draws around its fill. A bar that
// does not move with `xp` reads nothing filled at xp 12 and misses by four
// fifths.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertWithin } from "../assert";
import {
  BAR_SHARE_TOLERANCE,
  FIGURE_TOLERANCE,
  XP_BASE,
  XP_STEP,
} from "../constants";
import { createHarness, isolate, type Harness } from "../harness";
import {
  captureFrames,
  diffRunInRow,
  keepFrame,
  longestDiffRun,
  stageRect,
} from "./hud";

/** The level posed, whose `xpToNext` is 15. */
const LEVEL = 2;

/** `xpToNext(2)`, `XP_BASE + XP_STEP × (2 - 1)`. */
const NEEDED = XP_BASE + XP_STEP * (LEVEL - 1);

/** The part fill the item reads: 12 of 15, four fifths. */
const PART = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fills about four fifths of the experience bar at xp 12 of 15", async () => {
  const posed = isolate(h, { level: LEVEL });
  assertWithin(
    posed.run.xpToNext,
    NEEDED,
    FIGURE_TOLERANCE,
    `xpToNext at level ${LEVEL}`,
  );

  h.debug.setXp(0);
  await h.frameDraw();
  const empty = stageRect(h);
  const emptyFrame = keepFrame(h);

  isolate(h, { level: LEVEL });
  h.debug.setXp(PART);
  await h.frameDraw();
  const part = stageRect(h);
  const partFrame = keepFrame(h);
  captureFrames([emptyFrame, partFrame], "bar");

  isolate(h, { level: LEVEL });
  h.debug.setXp(NEEDED);
  await h.frameDraw();
  const full = stageRect(h);

  const whole = longestDiffRun(empty, full);
  assertGreaterThan(
    whole.width,
    0,
    `pixels differing between the frame at xp 0 and the frame at xp ${NEEDED}`,
  );
  const filled = diffRunInRow(empty, part, whole.row).width;

  assertWithin(
    filled / whole.width,
    PART / NEEDED,
    BAR_SHARE_TOLERANCE,
    `the share of the bar filled at xp ${PART} of ${NEEDED}`,
  );
});
