// hud/unit-health-bars — a surge unit carries a health bar above it whose extent
// falls as its hp does.
//
// THE RULE. specs/hud.md, The reads on the floor: "Each surge unit carries a
// health bar above it whose extent falls as its hp does."
//
// THREE HP READINGS ON ONE UNIT, AND THE THREE ARE WHAT THE BAR IS MEASURED WITH.
// The same unit, of the same type, standing on the same tile, is drawn at
// {@link HP_STEPS} of its maximum and nothing between the frames changes but its
// hp. A rectangle that reaches LESS FAR at each of them is the bar's extent;
// everything else on the floor — the unit's body, the track behind the bar, the
// grid under it — reaches the same distance at all three and is not it.
// `hud/bar.ts` does that reading, and it tries all four ways round a bar may
// empty, so a build that drains it leftward or from the top is read exactly as
// one that drains it rightward.
//
// THREE STEPS RATHER THAN TWO, because two readings decide only that SOMETHING
// about the bar answered the hp. A bar that halves once and then stops, or one
// that switches between a full state and an empty one, fails the second step
// while a bar whose extent is the hp clears both.
//
// THE HP IS POSED, NOT SHOT OFF. `setUnitHp` "sets the current hp. It does not
// kill the unit" (specs/instrumentation.md), so the three readings are of one
// unit at three hps rather than of a fight; no tower is on the floor, and the
// unit's own motion is held, so it neither moves out from under its own bar nor
// walks into an exhaust while the three frames are drawn.
//
// THE BAR IS LOOKED FOR ABOVE THE UNIT, which is where specs/hud.md puts it, in a
// window of {@link WINDOW_TILES} tiles around the unit's centre. The floor holds
// exactly one unit and no tower, so nothing else can be in that window but what
// the build drew for this unit.
//
// A MOTE, because specs/surge.md gives it the plainest figures of the six — a
// ground unit at a middling speed with no slow resistance and no special
// behaviour — so the reading is of the bar and not of anything the type brings
// with it.
//
// WHAT IT DOES NOT DECIDE. What a unit's hp should BE is `surge.*`, what takes it
// away is `combat.*`, and that a unit reads apart from the floor is
// `presentation.surge-reads-apart-from-the-floor`.

import { afterEach, beforeEach, it } from "vitest";
import { TILE } from "../constants";
import {
  captureStill,
  createHarness,
  drawFrame,
  drawnRects,
  poseTarget,
  startRun,
  unitOf,
  type DrawnRect,
  type Harness,
} from "../harness";
import { findBar } from "./bar";

/** The unit read, and the tile it stands on: clear of both corridors. */
const TYPE = "mote";
const AT = { col: 9, row: 6 };

/** The maximum hp posed, so the three steps below are round fractions of it. */
const MAX_HP = 100;

/**
 * The hps the bar is read at, in falling order.
 *
 * Three quarters of the scale apart in total and never at either end, so a bar
 * whose extent is the hp moves at both steps while one that only switches between
 * full and empty does not.
 */
const HP_STEPS = [MAX_HP, MAX_HP * 0.6, MAX_HP * 0.2];

/**
 * How much less far the bar must reach between consecutive hps, in logical units.
 *
 * The steps above are two fifths of the scale each, so a bar drawn across even a
 * third of a tile shortens by two units at both of them. One unit is a floor
 * rather than a target: it refuses a bar that does not move while admitting one
 * drawn at any length a player could see.
 */
const STEP_MIN = 1;

/**
 * How far around the unit's centre the bar is looked for, in tiles.
 *
 * specs/hud.md draws it "above it" and fixes neither how far above nor how wide,
 * and specs/overview.md leaves the unit's own size to the build, so the window is
 * wide enough for any sprite a tile-sized unit could reasonably carry. Nothing
 * else is on the floor to be found in it.
 */
const WINDOW_TILES = 3;

/** The run the unit is read on. */
const MODE = "containment";
const DIFFICULTY = "hard";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a health bar above the unit whose extent falls as its hp does", async () => {
  startRun(h, MODE, DIFFICULTY);
  h.debug.setPhase("wave");

  const id = poseTarget(h, TYPE, AT.col, AT.row, MAX_HP);
  const unit = unitOf(h.snapshot(), id);
  const window = WINDOW_TILES * TILE;
  const above = (rect: DrawnRect): boolean =>
    rect.bottom <= unit.y &&
    rect.top >= unit.y - window &&
    rect.left >= unit.x - window &&
    rect.right <= unit.x + window;

  const frames: DrawnRect[][] = [];
  for (const hp of HP_STEPS) {
    h.debug.setUnitHp(id, hp);
    const calls = await drawFrame(h);
    if (hp === HP_STEPS[1]) captureStill(h, "bars");
    frames.push(drawnRects(h, calls).filter(above));
  }

  findBar(
    frames,
    -1,
    STEP_MIN,
    `a health bar above the ${TYPE} whose extent falls as its hp falls ` +
      `through ${HP_STEPS.join(", ")} of ${MAX_HP} (specs/hud.md, The reads ` +
      `on the floor)`,
  );
});
