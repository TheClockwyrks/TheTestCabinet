// hud/unit-health-bars — a surge unit carries a bar above it whose extent falls
// as its hp does.
//
// THE RULE. specs/hud.md, The reads on the floor: "Each surge unit carries a
// health bar above it whose extent falls as its hp does."
//
// HOW A BAR IS READ WHEN NOTHING FIXES ITS LAYOUT OR ITS COLOUR. A bar whose
// extent follows a quantity is a mark with ONE END THAT STAYS PUT whose LENGTH
// changes as the quantity changes, so that is what is looked for: among the
// rectangles the frame drew around the unit, the one with an end in the same
// place at two hp levels and a different length. Either end counts and either
// axis counts, so a bar anchored at its left end and one anchored at its right,
// running across or up, are all found — specs/overview.md fixes no palette to
// name and specs/hud.md fixes no layout.
//
// THREE HP LEVELS, BECAUSE "FALLS AS ITS HP DOES" IS A DIRECTION. Full, half and
// a tenth: the bar must be strictly shorter each time. A build whose bar has two
// states, or one drawn at a fixed length, or one that grows as the unit is hurt,
// fails; a build that draws no such mark has no extent to read and fails there.
//
// THE MAXIMUM IS POSED AS WELL AS THE HP, because the bar is drawn against the
// unit's maximum and a Hulk's own maximum is its base hp scaled for the wave
// (specs/waves.md). Posing a round `100` makes each of the three readings an
// exact fraction of the bar, so a build that drew the bar against the wrong
// figure reads a different length at every one of them.
//
// THE UNIT HOLDS ITS TILE AND NOTHING SHOOTS IT. `poseTarget` turns its motion
// off, so the bar is drawn at the same place at all three readings and the marks
// can be paired at all; the floor carries no tower, so nothing removes hp
// underneath the reading; and a tenth of the maximum is above `0`, so the unit is
// not removed by the damage path (specs/surge.md).
//
// WHAT THIS POINT CANNOT DECIDE, and it is worth being plain about it. A bar
// drawn as two coloured halves — a filled part and a remainder — is, with the
// colours taken away, the mirror image of the same bar drawn inverted, and no
// colour-free reading tells the two apart: whichever mark shortens as the hp
// falls, this point finds it. What the item's captured still is for is a
// reviewer's eye on exactly that. A build that draws only the filled part, which
// is the common case, is decided here outright.

import { afterEach, beforeEach, it } from "vitest";
import { TILE, tileCX, tileCY } from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  poseTarget,
  startRun,
  type ControlRect,
  type Harness,
} from "../harness";
import {
  findSpanMark,
  readRects,
  spanAt,
  unitOf,
  type DrawnRect,
} from "./panel";
import { QUIET_STAND } from "./sites";

/** The unit read. */
const TYPE = "hulk" as const;

/** Where it stands: a quiet tile, clear of both corridors and every opening. */
const AT = QUIET_STAND;

/** The maximum posed, so each reading is an exact fraction of the bar. */
const MAX_HP = 100;

/** The three hp levels read, full to a tenth. */
const LEVELS = [100, 50, 10] as const;

/**
 * The patch of floor read: the unit's centre and three tiles around it.
 *
 * specs/hud.md puts the bar "above it" and fixes nothing else — not its length,
 * not its thickness, not which axis it runs on, and not how far above the unit
 * it is drawn — and no specification fixes how large a unit is drawn either. So
 * the patch is wide enough to hold a bar of a tile or two, standing off the unit
 * by another, in any of those arrangements. Nothing else stands on the floor to
 * be caught by the extra reach: the run is posed empty and this unit is the only
 * thing on it.
 */
const REACH = 3 * TILE;

/** How far apart two rectangles may be drawn and still be the same mark. */
const SLACK = 0.5;

/**
 * The least the bar must shorten between two of the levels: one logical unit.
 *
 * The three levels are half and two fifths of the maximum apart, so a bar even
 * ten units long — a little over half a tile — shortens by more than a unit at
 * each step, and a unit is the floor at which a change is a change rather than a
 * rounding.
 */
const STEP = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("shortens the Hulk's health bar as its hp falls from full to a tenth", async () => {
  startRun(h);
  const id = poseTarget(h, TYPE, AT.col, AT.row, MAX_HP);
  const unit = unitOf(h.snapshot(), id, "the posed Hulk");
  const region: ControlRect = {
    x: unit.x - REACH,
    y: unit.y - REACH,
    w: 2 * REACH,
    h: 2 * REACH,
  };

  assertEqual(
    unit.maxHp,
    MAX_HP,
    "precondition: the Hulk's maximum hp is posed at 100",
  );
  assertEqual(
    unit.x,
    tileCX(AT.col),
    "precondition: the Hulk stands on its tile's centre",
  );
  assertEqual(
    unit.y,
    tileCY(AT.row),
    "precondition: the Hulk stands on its tile's centre",
  );

  const frames = new Map<number, DrawnRect[]>();
  for (const hp of LEVELS) {
    h.debug.setUnitHp(id, hp);
    frames.set(hp, await readRects(h, region));
    if (hp === LEVELS[LEVELS.length - 1]) captureStill(h, "bars");
    const posed = unitOf(h.snapshot(), id, `the Hulk at ${hp} hp`);
    assertEqual(posed.hp, hp, `precondition: the Hulk's hp is posed at ${hp}`);
  }

  const full = frames.get(LEVELS[0]) ?? [];
  const least = frames.get(LEVELS[LEVELS.length - 1]) ?? [];
  const bar = findSpanMark(full, least, SLACK);
  assertTrue(
    bar !== null,
    `a mark around the Hulk with one end in the same place at ${LEVELS[0]} hp ` +
      `and at ${LEVELS[LEVELS.length - 1]} hp and a different length, which ` +
      `is what a health bar whose extent falls with the hp is (specs/hud.md)`,
  );
  if (bar === null) return;

  let previous: number | null = null;
  for (const hp of LEVELS) {
    const extent = spanAt(frames.get(hp) ?? [], bar, SLACK);
    assertTrue(extent !== null, `the health bar to still be drawn at ${hp} hp`);
    if (extent === null) return;
    if (previous !== null) {
      assertGreaterThanOrEqual(
        previous - extent,
        STEP,
        `how much shorter the health bar is at ${hp} hp than at the level ` +
          `before it (specs/hud.md)`,
      );
    }
    previous = extent;
  }
});
