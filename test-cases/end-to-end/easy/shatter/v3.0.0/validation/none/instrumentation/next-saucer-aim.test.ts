// instrumentation/next-saucer-aim — `setNextSaucerAim` decides the aim error of
// the saucer's next shot, and the shot consumes the pose.
//
// THE RULE. `specs/instrumentation.md`, "Posed draws": `setNextSaucerAim(radians)`
// "poses the aim error of the next shot the saucer fires, in radians, in place of
// the draw from `-SAUCER_AIM_ERROR` to `+SAUCER_AIM_ERROR`", reported as
// `nextSaucerAim`, and the shot consumes it.
//
// THE SCENARIO IS `saucer/aim.ts`'S: the saucer held still with its mind off and
// the ship posed four hundred units away, so the bearing to the ship is a figure
// this check knows and the round's bearing, less the saucer's own velocity of
// zero, is the aim. Two shots on one visit, posed with opposite errors near the
// edge of the range, so a build that ignores the pose and draws — which lands
// within the tolerance of either by chance about one time in forty — cannot land
// on both.
//
// THE TOLERANCE is half a degree: a bearing read off a velocity that made a round
// trip through JSON, against an error posed eight degrees off the bearing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertLessThanOrEqual } from "../assert";
import { DEG, SAUCER_FIRE_INTERVAL } from "../constants";
import { angleDelta, bearingOf, bearingTo, subtract } from "../geometry";
import {
  captureStill,
  createHarness,
  poseSaucer,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { SAUCER_STAND, SHIP_STAND } from "../saucer/aim";
import { nextVolley } from "../saucer/cadence";

/** The two errors posed, in degrees: near the edge of the range, opposite ways. */
const POSED_ERRORS_DEG = [8, -8] as const;

/** How far the read aim may stand from the posed one, in degrees. */
const AIM_TOLERANCE_DEG = 0.5;

/** How long a wait for a shot runs: a little over one fire interval. */
const SHOT_CEILING = ticksFor(SAUCER_FIRE_INTERVAL + 0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires the next shot with the posed aim error and consumes the pose", async () => {
  await startPlaying(h);
  await h.debug.setShipPosition(SHIP_STAND.x, SHIP_STAND.y);
  await poseSaucer(h, SAUCER_STAND.x, SAUCER_STAND.y, {
    vx: 0,
    vy: 0,
    mind: false,
    travel: false,
  });
  const wanted = bearingTo(SAUCER_STAND, SHIP_STAND);

  let held: number[] = [];
  for (const [index, errorDeg] of POSED_ERRORS_DEG.entries()) {
    await h.debug.setNextSaucerAim(errorDeg * DEG);
    assertEqual(
      Math.abs(
        ((await h.snapshot()).nextSaucerAim ?? Number.NaN) - errorDeg * DEG,
      ) < 1e-9,
      true,
      `setNextSaucerAim(${errorDeg} degrees) read back before the shot (specs/instrumentation.md)`,
    );

    const volley = await nextVolley(h, held, { maxTicks: SHOT_CEILING });
    held = volley.ids;
    if (index === 0) await captureStill(h, "posed");

    assertLength(volley.fired, 1, "the rounds the shot put on the field");
    const carried =
      volley.saucer === null
        ? { x: 0, y: 0 }
        : { x: volley.saucer.vx, y: volley.saucer.vy };
    const round = volley.fired[0];
    const aim = bearingOf(subtract({ x: round.vx, y: round.vy }, carried));
    assertLessThanOrEqual(
      Math.abs(angleDelta(wanted, aim) / DEG - errorDeg),
      AIM_TOLERANCE_DEG,
      `degrees between the shot's aim and the bearing to the ship offset by the posed ${errorDeg} (specs/instrumentation.md)`,
    );
    assertEqual(
      volley.snapshot.nextSaucerAim,
      null,
      `nextSaucerAim once the shot posed at ${errorDeg} degrees has consumed it (specs/instrumentation.md)`,
    );
  }
});
