// presentation/charges — the one arrangement the three charge points are read
// over: all five charges standing on the channel at once, well apart.
//
// WHY THE TOP RUN. `specs/channel.md` gives the channel as a polyline of twelve
// vertices, and leg 0 runs from the inlet `(40, 40)` to `(920, 40)` — 880 units
// of straight plate, the longest leg there is. Five cores spaced along it stand
// on plate, at `y = 40`, far enough apart that the disc of one is nowhere near
// the disc of the next: `specs/channel.md` draws a core as "a disc of
// `CORE_RADIUS` (`14` units)", so 120 units of separation leaves over 90 units of
// clear plate between two rims.
//
// The level opened is 5, the one level whose charge set is all five
// (`specs/progression.md`), so no core stands on a charge its level does not
// carry.

import { CHANNEL, CHARGE_IDS, type Point } from "../constants";
import { poseHall, topRunS, type Harness, type PosedCore } from "../harness";

/** Where the first core stands, in field units along the top run. */
const FIRST_X = 200;

/** How far apart two cores stand, in field units. */
const STRIDE = 120;

/** The level whose charge set holds all five charges. */
export const ALL_CHARGES_LEVEL = 5;

/** One core of each charge, spread along the straight top run. */
export const FIVE_CHARGES: readonly PosedCore[] = CHARGE_IDS.map(
  (charge, index) =>
    [topRunS(FIRST_X + index * STRIDE), charge, null] as PosedCore,
);

/**
 * Pose the five and run one tick, so the canvas carries the picture they make.
 *
 * A pose alone changes the state; the frame on the canvas is the one the most
 * recent tick left, so a check that reads pixels steps once first.
 */
export async function poseFiveCharges(h: Harness): Promise<void> {
  await poseHall(h, { level: ALL_CHARGES_LEVEL, cores: FIVE_CHARGES });
  await h.step(1);
}

/**
 * A patch of bare channel plate, on a leg no posed core stands on.
 *
 * Leg 8 of the polyline runs from `(220, 220)` to `(620, 220)`, so a point 100
 * units along it is `(320, 220)` — plate, 220 units below the top run the cores
 * are on.
 */
export const PLATE_POINT: Point = {
  x: CHANNEL[8].x + 100,
  y: CHANNEL[8].y,
};

/**
 * How far the empty-field patch sits from the nearest leg of the channel.
 *
 * The polyline's parallel legs are 100 units apart at their closest
 * (`y = 220` and `y = 320`, `y = 320` and `y = 420`), so a point midway between
 * two of them is as far from the channel as any point on this field can be, and
 * 50 units is that distance. The plate is drawn "wide enough to carry a core"
 * (`specs/channel.md`), which is 28 units across, so a plate this far from its
 * own centre line would have to be more than three times that wide.
 */
const FIELD_CLEARANCE = 50;

/** A patch of empty field, clear of every leg of the channel. */
export const FIELD_POINT: Point = {
  x: PLATE_POINT.x,
  y: PLATE_POINT.y + FIELD_CLEARANCE,
};
