// Shatter — saucer/aims-at-the-ship: the saucer's shots point at the ship.
//
// THE RULE. `specs/saucer.md`: "the saucer fires one saucer bullet AIMED AT THE
// SHIP'S CURRENT POSITION", and "The shot's bearing is the bearing from the saucer
// to the ship, offset by an angle drawn afresh for every shot, uniformly from
// `-SAUCER_AIM_ERROR` to `+SAUCER_AIM_ERROR`".
//
// THE ERROR IS POSED AT ZERO, SO THE AIM IS READ DIRECTLY. The draw is what stands
// between a shot and the bearing to the ship, and `specs/instrumentation.md` gives
// the surface `setNextSaucerAim`, which sets the outcome of that draw for the next
// shot. With it posed at `0` the round has to leave along the bearing to the ship
// exactly, and the reading is one shot rather than the mean of a sample. The draw's
// own range and scatter are `aim-error-within-10-degrees`'s and
// `aim-error-varies-per-shot`'s items, read off unposed shots.
//
// TWO SAUCER POSITIONS, ON OPPOSITE SIDES OF THE SHIP, so a build that fires along
// a fixed bearing, or at the ship's safe point rather than at the ship, reads wrong
// on at least one of them. The saucer is held still with its mind off, so its own
// velocity is zero and the round's velocity is the aim; the ship stands four
// hundred units away, well inside a straight shot.
//
// THE TOLERANCE is half a degree: a bearing read off a velocity that made a round
// trip through JSON, and nothing else. A build that aims a whole degree off is
// twice the bound out.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertLessThanOrEqual } from "../assert";
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
import { SAUCER_STAND, SHIP_STAND } from "./aim";
import { nextVolley } from "./cadence";

/** The two stands: `aim.ts`'s, and its mirror on the far side of the ship. */
const STANDS = [
  SAUCER_STAND,
  { x: SHIP_STAND.x + (SHIP_STAND.x - SAUCER_STAND.x), y: SAUCER_STAND.y },
] as const;

/** How far the shot's aim may stand from the bearing to the ship, in degrees. */
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

it("fires a shot with no aim error straight along the bearing to the ship", async () => {
  await startPlaying(h);
  await h.debug.setShipPosition(SHIP_STAND.x, SHIP_STAND.y);

  for (const [index, stand] of STANDS.entries()) {
    await h.debug.clearEnemyBullets();
    await poseSaucer(h, stand.x, stand.y, {
      vx: 0,
      vy: 0,
      mind: false,
      travel: false,
    });
    await h.debug.setNextSaucerAim(0);

    const volley = await nextVolley(h, [], { maxTicks: SHOT_CEILING });
    if (index === 0) await captureStill(h, "aim");

    assertLength(volley.fired, 1, "the rounds the shot put on the field");
    const carried =
      volley.saucer === null
        ? { x: 0, y: 0 }
        : { x: volley.saucer.vx, y: volley.saucer.vy };
    const round = volley.fired[0];
    const aim = bearingOf(subtract({ x: round.vx, y: round.vy }, carried));
    assertLessThanOrEqual(
      Math.abs(angleDelta(bearingTo(stand, SHIP_STAND), aim) / DEG),
      AIM_TOLERANCE_DEG,
      `degrees between the shot's aim and the bearing from (${stand.x}, ${stand.y}) to the ship, with the aim error posed at 0 (specs/saucer.md)`,
    );
  }
});
