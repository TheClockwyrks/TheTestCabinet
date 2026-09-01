// hud/on-floor-heat-read — a placed tower carries a heat read on its footprint
// whose extent tracks its heat.
//
// THE RULE. specs/hud.md, The reads on the floor: "Each placed tower carries a
// heat read on its footprint whose extent tracks its heat, with a marker at the
// tower's redline." The extent is this point's half of that sentence; the marker
// is `hud/on-floor-redline-marker`'s.
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
// A LANCE, BECAUSE ITS 4x4 FOOTPRINT IS THE LARGEST THIS CASE HAS, so the track
// the read is drawn on is as long as this floor makes them and a read that does
// not move has the most room in which to fail to move. Its redline of 92
// (specs/towers.md) also sits above every heat below `TRIP_HEAT` posed here, so
// the reading does not turn on how a build scales the part of the read past it.
//
// THE HEAT IS PINNED AT EVERY FRAME. `posePinnedTower` holds the tower's part in
// the heat model (specs/instrumentation.md), so each frame draws the heat this
// check posed rather than one that has already begun to cool; and the floor holds
// nothing else, so nothing conducts with it, nothing is fired at, and the tower at
// `TRIP_HEAT` never crosses into a trip — the trip is a crossing the heat model
// makes, and the model is held (specs/heat.md, The trip).
//
// WHAT IT DOES NOT DECIDE. The marker at the redline is
// `hud.on-floor-redline-marker`. That the tower's own colour tracks its heat is
// `presentation.heat-glow-ramp`, and what the heat DOES is the `heat` and `trip`
// groups. This point decides that the floor says what a tower's heat is.

import { afterEach, beforeEach, it } from "vitest";
import { TILE, TRIP_HEAT, tileLeft, tileTop } from "../../src/constants";
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
import { findBar } from "./bar";

/** The tower read: the 4x4 Lance, whose footprint is the largest on this floor. */
const TYPE = "lance";

/** A quiet anchor: no opening and no corridor within a 4x4 footprint of it. */
const AT = { col: 4, row: 4 };

/**
 * The heats the read is drawn at, in rising order, the last of them the top of
 * the scale.
 *
 * They are spread across the scale so the read has to move three times rather
 * than once, and the last of them is `TRIP_HEAT` so a read that stops moving
 * short of the top of its own scale is caught.
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

it("draws a heat read whose extent tracks the heat", async () => {
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

  findBar(
    frames,
    1,
    STEP_MIN,
    `a heat read on the ${TYPE}'s footprint whose extent grows with its heat ` +
      `across ${HEATS.join(", ")} (specs/hud.md, The reads on the floor)`,
  );
});
