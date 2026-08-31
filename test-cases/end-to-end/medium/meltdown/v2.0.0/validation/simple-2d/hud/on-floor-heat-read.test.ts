// hud/on-floor-heat-read — a placed tower carries a heat read on its footprint
// whose extent tracks its heat, with a marker at its redline.
//
// THE RULE. specs/hud.md, The reads on the floor: "Each placed tower carries a
// heat read on its footprint whose extent tracks its heat, with a marker at the
// tower's redline." specs/overview.md's legibility table says what the read is
// FOR: "so a tower sitting in its plateau is told from one that is cold or about
// to trip" — which is why the read runs the whole scale to `TRIP_HEAT` and the
// redline is a mark along it rather than its end.
//
// FOUR HEATS ON ONE TOWER, AND THE FOUR ARE WHAT THE READ IS MEASURED WITH. The
// same tower, on the same tile, at the same type, level and rotation, is drawn at
// {@link HEATS} and nothing between the frames changes but the heat. A rectangle
// that reaches further at each of them is the read's extent; everything else the
// footprint carries — the body, the radiator faces, the track behind the read —
// reaches the same distance at all four and is not it. `hud/bar.ts` does that
// reading, and it tries all four ways round a bar may fill, so a build that draws
// its read as an upright thermometer is read exactly as one that draws a strip.
//
// THE MARKER IS FOUND WHERE THE SPECIFICATION PUTS IT: at the redline's fraction
// of the whole scale, along the read's own track. The frame at `TRIP_HEAT` is
// what gives the track its full extent, so the marker is due at
// `redline / TRIP_HEAT` of the way along it from where the read starts. What is
// looked for there is a rectangle every one of the four frames drew identically —
// the marker cannot move with the heat, or it would be a second read rather than
// a mark — whose centre falls within {@link MARKER_TOLERANCE} of that point.
//
// A LANCE, BECAUSE ITS REDLINE IS THE ONE THAT PROVES A MARKER RATHER THAN A
// DECORATION. specs/towers.md gives it 92, so the mark is due nine tenths of the
// way along the track and nowhere near the middle or either end: a build that
// centres a tick, that puts one at the far end, or that draws the read to the
// redline rather than to `TRIP_HEAT` all miss it. Its 4x4 footprint is also the
// largest this case has, so the track it is drawn on is as long as this floor
// makes them and the tolerance is at its most demanding in proportion.
//
// THE HEAT IS PINNED AT EVERY FRAME. `posePinnedTower` holds the tower's part in
// the heat model (specs/instrumentation.md), so each frame draws the heat this
// check posed rather than one that has already begun to cool; and the floor holds
// nothing else, so nothing conducts with it, nothing is fired at, and the tower at
// `TRIP_HEAT` never crosses into a trip — the trip is a crossing the heat model
// makes, and the model is held (specs/heat.md, The trip).
//
// WHAT IT DOES NOT DECIDE. That the tower's own colour tracks its heat is
// `presentation.heat-glow-ramp`, and what the heat DOES is the `heat` and `trip`
// groups. This point decides that the floor says what a tower's heat is.

import { afterEach, beforeEach, it } from "vitest";
import {
  TILE,
  TOWER_DEFS,
  TRIP_HEAT,
  tileLeft,
  tileTop,
} from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import { sizeOf } from "../geometry";
import {
  captureStill,
  createHarness,
  drawFrame,
  drawnRects,
  posePinnedTower,
  startRun,
  type DrawnRect,
  type Harness,
} from "../harness";
import { drawnInEveryFrame, findBar } from "./bar";
import { showRect } from "./read";

/** The tower read, and the redline specs/towers.md gives it: 92. */
const TYPE = "lance";
const DEF = TOWER_DEFS[TYPE];
const REDLINE = DEF.kind === "emitter" ? DEF.redline : 0;

/** A quiet anchor: no opening and no corridor within a 4x4 footprint of it. */
const AT = { col: 4, row: 4 };

/**
 * The heats the read is drawn at, in rising order, the last of them the top of
 * the scale.
 *
 * The first three are spread across the scale so the read has to move three
 * times rather than once, and `TRIP_HEAT` is what gives the track its full
 * extent, which is what the marker's position is measured along.
 */
const HEATS = [20, 50, 80, TRIP_HEAT];

/**
 * How much further the read must reach between consecutive heats, in logical
 * units.
 *
 * The steps above are 30, 30 and 20 points of a 100-point scale, so a read drawn
 * across even a quarter of this 76-unit footprint moves by five units and more at
 * every one of them. One unit is a floor rather than a target: it refuses a read
 * that does not move while admitting one drawn on a track of any length.
 */
const STEP_MIN = 1;

/**
 * How far the marker's centre may sit from the redline's point on the track, in
 * logical units.
 *
 * A marker is a tick of its own width and a build may centre it on the redline or
 * hang it from one side, so a few units of slack is honest. Four is about a
 * twentieth of this tower's 76-unit footprint, which is far tighter than the gap
 * between the redline's point and any other place a build would naturally put a
 * fixed mark: the middle of the track is 29 units away and its far end 6.
 */
const MARKER_TOLERANCE = 4;

/** How far outside the footprint a rectangle may reach and still be part of the
 * read: the read is drawn ON the footprint (specs/hud.md), and a unit of slack
 * covers a border stroked on its edge. */
const FOOTPRINT_SLACK = 1;

/** The run the tower is read on. */
const MODE = "containment";
const DIFFICULTY = "hard";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a heat read whose extent tracks the heat, marked at the redline", async () => {
  startRun(h, MODE, DIFFICULTY);
  h.debug.setPhase("wave");

  const id = posePinnedTower(h, TYPE, AT.col, AT.row, HEATS[0]);

  const span = sizeOf(TYPE) * TILE;
  const left = tileLeft(AT.col);
  const top = tileTop(AT.row);
  const onFootprint = (rect: DrawnRect): boolean =>
    rect.left >= left - FOOTPRINT_SLACK &&
    rect.right <= left + span + FOOTPRINT_SLACK &&
    rect.top >= top - FOOTPRINT_SLACK &&
    rect.bottom <= top + span + FOOTPRINT_SLACK;

  const frames: DrawnRect[][] = [];
  for (const heat of HEATS) {
    h.debug.setTowerHeat(id, heat);
    const calls = await drawFrame(h);
    if (heat === HEATS[2]) captureStill(h, "heat");
    frames.push(drawnRects(h, calls).filter(onFootprint));
  }

  const bar = findBar(
    frames,
    1,
    STEP_MIN,
    `a heat read on the ${TYPE}'s footprint whose extent grows with its heat ` +
      `across ${HEATS.join(", ")} (specs/hud.md, The reads on the floor)`,
  );

  const track = bar.rects[bar.rects.length - 1];
  const marked = bar.axis.along(track, REDLINE / TRIP_HEAT);
  const fixed = drawnInEveryFrame(frames);
  const nearest = fixed.reduce<DrawnRect | null>(
    (best, rect) =>
      best === null ||
      Math.abs(bar.axis.centre(rect) - marked) <
        Math.abs(bar.axis.centre(best) - marked)
        ? rect
        : best,
    null,
  );

  assertLessThanOrEqual(
    nearest === null ? Infinity : Math.abs(bar.axis.centre(nearest) - marked),
    MARKER_TOLERANCE,
    `how far the nearest mark that does not move with the heat sits from the ` +
      `${TYPE}'s redline of ${REDLINE} on a read ${bar.axis.name} and running ` +
      `to ${TRIP_HEAT} (specs/hud.md, The reads on the floor); the read filled ` +
      `${bar.extents.map((e) => e.toFixed(1)).join(", ")} across heats ` +
      `${HEATS.join(", ")}, and the nearest fixed mark was ` +
      `${nearest === null ? "none at all" : showRect(nearest)}`,
  );
});
