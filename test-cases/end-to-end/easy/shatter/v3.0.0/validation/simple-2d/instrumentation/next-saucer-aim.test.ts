// instrumentation/next-saucer-aim — `setNextSaucerAim` decides the aim error of
// the saucer's next shot, and the shot consumes the pose.
//
// THE RULE. `specs/instrumentation.md`, "Posed draws":
// `setNextSaucerAim(radians)` "poses the aim error of the next shot the saucer
// fires, in radians, in place of the draw from `-SAUCER_AIM_ERROR` to
// `+SAUCER_AIM_ERROR`", reported as `nextSaucerAim`, and the shot consumes it.
//
// THE SCENARIO IS `saucer/aim.ts`'S: the saucer held still with its mind off and
// the ship posed four hundred units away, so the bearing to the ship is a figure
// this check knows and the round's bearing, less the saucer's own velocity of
// zero, is the aim. Two shots on one visit, posed with opposite errors near the
// edge of the range, so a build that ignores the pose and draws — which lands
// within the tolerance of either by chance about one time in forty — cannot land
// on both.
//
// THE TOLERANCE is half a degree: a bearing read off a velocity, against an
// error posed eight degrees off the bearing.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertLessThanOrEqual,
  fail,
} from "../assert";
import { SAUCER_FIRE_INTERVAL } from "../constants";
import {
  angleBetween,
  degrees,
  headingOf,
  radians,
  separation,
} from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { SAUCER_STAND, SHIP_STAND } from "../saucer/aim";
import { nextVolley } from "../saucer/cadence";
import { poseVisit } from "../saucer/visit";

/** The two errors posed, in degrees: near the edge of the range, opposite ways. */
const POSED_ERRORS_DEG = [8, -8] as const;

/** How far the read aim may stand from the posed one, in degrees. */
const AIM_TOLERANCE_DEG = 0.5;

/** How long a wait for a shot runs: a little over one fire interval. */
const SHOT_CEILING = ticksFor(SAUCER_FIRE_INTERVAL + 0.5);

/** The decimal places the posed error is read back to: exactly. */
const READ_BACK_DIGITS = 9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fires the next shot with the posed aim error and consumes the pose", async () => {
  startPlaying(h);
  h.debug.setShipPosition(SHIP_STAND.x, SHIP_STAND.y);
  poseVisit(h, SAUCER_STAND.x, SAUCER_STAND.y, {
    vx: 0,
    vy: 0,
    mind: false,
    travel: false,
  });
  const toShip = separation(SAUCER_STAND, SHIP_STAND);
  const wanted = Math.atan2(toShip.y, toShip.x);

  for (const [index, errorDeg] of POSED_ERRORS_DEG.entries()) {
    h.debug.setNextSaucerAim(radians(errorDeg));
    assertEqual(
      Math.abs((h.snapshot().nextSaucerAim ?? Number.NaN) - radians(errorDeg)) <
        10 ** -READ_BACK_DIGITS,
      true,
      `setNextSaucerAim(${errorDeg} degrees) read back before the shot ` +
        "(specs/instrumentation.md)",
    );

    const volley = await nextVolley(h, { maxTicks: SHOT_CEILING });
    if (index === 0) captureStill(h, "posed");

    assertLength(volley.fired, 1, "the rounds the shot put on the field");
    const carried = volley.saucer ?? { vx: 0, vy: 0 };
    const round = volley.fired[0];
    const aim = headingOf({
      vx: round.vx - carried.vx,
      vy: round.vy - carried.vy,
    });
    if (aim === null) {
      fail(
        "a round leaving at SAUCER_BULLET_SPEED along a bearing (specs/saucer.md)",
        "a saucer bullet with no velocity of its own",
      );
    }
    assertLessThanOrEqual(
      Math.abs(degrees(angleBetween(wanted, aim)) - errorDeg),
      AIM_TOLERANCE_DEG,
      "degrees between the shot's aim and the bearing to the ship offset by " +
        `the posed ${errorDeg} (specs/instrumentation.md)`,
    );
    assertEqual(
      volley.snapshot.nextSaucerAim,
      null,
      `nextSaucerAim once the shot posed at ${errorDeg} degrees has consumed ` +
        "it (specs/instrumentation.md)",
    );
  }
});
