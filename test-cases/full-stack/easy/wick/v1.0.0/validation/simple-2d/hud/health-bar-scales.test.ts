// hud/health-bar-scales — the health bar's filled width scales with hp / maxHp.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`playing`", the HUD table):
// "Health | A bar whose filled width scales with `hp / maxHp`, with both
// numbers beside it, `hp` rounded up to a whole number." No passive is held, so
// `maxHp` is `BASE_MAX_HP` (`100`) by specs/passives.md ("`maxHp` is
// `BASE_MAX_HP` (`100`) plus `TALLOW_HP_PER_LEVEL` per Tallow level"), and the
// three poses below are hp `100`, hp `25`, and hp `0.5`, whose fills are the
// whole bar, a quarter of it, and a two-hundredth of it. A quarter of the full
// width is what the filled width at hp 25 must be.
//
// THE WORLD. Three isolated `playing` runs, each posed through `isolate`, which
// resets first: nothing alive, nothing on the ground, no weapon and no passive
// held, every driver switch off. Each frame is therefore the same empty night
// drawn on the same tick with the lamplighter at the same place, and the only
// pixels two of them can differ in are the ones the health pose moved.
//
// WHAT IS READ. The longest run of horizontally adjacent differing pixels
// between the hp 100 frame and the hp 0.5 frame, which is the bar drained to
// nothing and so `0.995` of its full width; then the same reading taken along
// THAT ROW between the hp 100 frame and the hp 25 frame, which is the part of
// the bar the missing three quarters emptied. The full width follows from the
// first and the filled width at hp 25 is what the second leaves of it. Both
// readings are runs rather than pixel counts, so the health numbers beside the
// bar, which move with the same pose, cannot be mistaken for the bar: the
// longest horizontal stroke of a glyph is a glyph wide.
//
// TOLERANCE. BAR_SHARE_TOLERANCE, a fifth of the bar's full width, which admits
// any border, rounding, or end-cap a build draws around its fill. A bar that
// does not move with `hp` reads its whole width as filled at hp 25 and misses
// by three quarters.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertWithin, assertLength } from "../assert";
import {
  BAR_SHARE_TOLERANCE,
  BASE_MAX_HP,
  FIGURE_TOLERANCE,
} from "../constants";
import { createHarness, isolate, type Harness } from "../harness";
import {
  captureFrames,
  diffRunInRow,
  keepFrame,
  longestDiffRun,
  stageRect,
} from "./hud";

/** The full bar: hp at `maxHp`, whose fill is the whole width. */
const FULL = BASE_MAX_HP;

/** The quarter bar the item reads: hp 25 of 100. */
const QUARTER = 25;

/**
 * The drained bar the full width is measured against: hp `0.5` of 100, a fill
 * of a two-hundredth. Above `0` by specs/world.md ("Fallen and dawn"), so the
 * frame is a `playing` frame rather than the run's end.
 */
const DRAINED = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fills about a quarter of the health bar at hp 25 of 100", async () => {
  const posed = isolate(h);
  assertLength(posed.run.passives, 0, "passives held, so no Tallow");
  assertWithin(
    posed.run.maxHp,
    BASE_MAX_HP,
    FIGURE_TOLERANCE,
    "maxHp with no Tallow held",
  );

  h.debug.setHp(FULL);
  await h.frameDraw();
  const full = stageRect(h);
  const fullFrame = keepFrame(h);

  isolate(h);
  h.debug.setHp(QUARTER);
  await h.frameDraw();
  const quarter = stageRect(h);
  const quarterFrame = keepFrame(h);
  captureFrames([fullFrame, quarterFrame], "bar");

  isolate(h);
  h.debug.setHp(DRAINED);
  await h.frameDraw();
  const drained = stageRect(h);

  const emptied = longestDiffRun(full, drained);
  assertGreaterThan(
    emptied.width,
    0,
    `pixels differing between the frame at hp ${FULL} and the frame at hp ${DRAINED}`,
  );
  const width = emptied.width / (1 - DRAINED / BASE_MAX_HP);
  const missing = diffRunInRow(full, quarter, emptied.row).width;

  assertWithin(
    (width - missing) / width,
    QUARTER / BASE_MAX_HP,
    BAR_SHARE_TOLERANCE,
    `the share of the bar filled at hp ${QUARTER} of ${BASE_MAX_HP}`,
  );
});
