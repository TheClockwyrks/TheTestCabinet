// overload/match-still-destroys — a matching shot destroys whatever the charge.
//
// specs/mode.md keeps the destroying half of specs/bands.md untouched under this
// mode: "A shot whose effective band matches still destroys the drone's exposed
// layer, whatever charge it carries." So the charge changes what a MISMATCH does
// and nothing about what a match does.
//
// THE CHARGE IS POSED AS HIGH AS PLAY EVER CARRIES IT — `OVERLOAD_AT - 1` (2),
// which specs/mode.md fixes as the ceiling ("play never carries it above
// `OVERLOAD_AT - 1`") — because that is the state a build implementing the charge
// is most likely to have made special. A drone one shot short of overloading is
// still an ordinary drone to a matching shot.
//
// THE SHOT IS THE MATCHING ONE, read off the drone rather than assumed: the band
// it reads as, which specs/bands.md says destroys it. A build that lets a charged
// drone shrug off a matching shot, or that treats every contact on a charged drone
// as a charge, leaves the drone on the roster and fails here.
//
// THE STILL IS KEPT WHILE THE SHOT IS STILL CLOSING, not after it lands, because
// this scenario destroys the only drone on the field and specs/stages.md clears a
// stage "in the moment the last drone of its wave is destroyed" — so the frame
// after the shot lands may already be the stage-cleared interstitial, in which the
// shot, the target and the field are all gone. Nothing about the verdict rests on
// where the picture was taken.
//
// WHAT THIS DOES NOT DECIDE. What a matching shot pays or pops, which are the
// `scoring` and `bursts` groups'; and that a matching shot destroys an UNCHARGED
// drone, which is `bands/match-destroys`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  OVERLOAD_AT,
  PLAYER_BULLET_HALF,
  PLAYER_BULLET_SPEED,
  SHARD_HALF,
} from "../../src/constants";
import { assertEqual, assertUndefined } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  droneById,
  fireAt,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { chargeById, poseCharge, requireDrone } from "./charge";

/** Where the target Shard stands. As in `overload/mismatch-charges`. */
const TARGET_X = LANE_CENTER;
const TARGET_Y = 300;

/** The centre separation a contact needs: `SHARD_HALF` + `PLAYER_BULLET_HALF`. */
const TOUCHING = SHARD_HALF + PLAYER_BULLET_HALF;

/** How far below the target the shot starts: seven times the contact reach. */
const SHOT_BELOW = 7 * TOUCHING;

/** How near the target the still is kept: twice the contact reach. */
const CLOSING = 2 * TOUCHING;

/**
 * Frames flown before the still is kept.
 *
 * The climb from `SHOT_BELOW` to `CLOSING` at `PLAYER_BULLET_SPEED` (`760`,
 * specs/ship.md). Nothing is asserted at this point: the span decides only where
 * the picture is taken.
 */
const CLOSING_TICKS = ticksFor((SHOT_BELOW - CLOSING) / PLAYER_BULLET_SPEED);

/**
 * Frames the whole flight is allowed.
 *
 * `SHOT_BELOW - TOUCHING` = 120 units of climb bring the bullet inside the contact
 * reach, which is 16 frames of the harness's 100 Hz clock. Thirty leaves fourteen
 * frames of slack for whichever sub-step a build resolves the contact on.
 */
const FLIGHT_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("destroys a drone carrying charge when the shot's band matches", async () => {
  startPosed(h);
  const target = poseDrone(h, "shard", TARGET_X, TARGET_Y, { band: "cyan" });
  poseCharge(h, target, OVERLOAD_AT - 1);

  const posed = requireDrone(h.snapshot(), target, "the shot's target");
  assertEqual(
    chargeById(
      h.snapshot(),
      target,
      "the Shard posed one charge short of an overload",
    ),
    OVERLOAD_AT - 1,
    "the charge the drone carries into the matching shot " +
      "(specs/instrumentation.md)",
  );

  await fireAt(
    h,
    posed.x,
    posed.y,
    posed.effectiveBand,
    SHOT_BELOW,
    CLOSING_TICKS,
  );
  captureStill(h, "destroyed");
  await h.advance(FLIGHT_TICKS - CLOSING_TICKS);

  assertUndefined(
    droneById(h.snapshot(), target),
    `the Shard at charge ${String(OVERLOAD_AT - 1)} a matching ` +
      `${posed.effectiveBand} shot destroys, whatever charge it carries ` +
      "(specs/mode.md)",
  );
});
