// presentation/charges — the one arrangement the charge point is read over: all
// five charges standing on the channel at once, well apart.
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

import { CHARGE_IDS } from "../constants";
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
 * Pose the five and run one tick, so a frame carrying the picture they make has
 * been drawn.
 *
 * A pose alone changes the state; the frame the build drew is the one the most
 * recent tick left, so a check that reads that frame steps once first.
 */
export async function poseFiveCharges(h: Harness): Promise<void> {
  await poseHall(h, { level: ALL_CHARGES_LEVEL, cores: FIVE_CHARGES });
  await h.step(1);
}
