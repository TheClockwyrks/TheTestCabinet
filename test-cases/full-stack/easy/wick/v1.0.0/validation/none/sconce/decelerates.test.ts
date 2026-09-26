// Wick — sconce/decelerates: a sconce's speed falls at `SCONCE_DECEL` along
// its launch direction.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Sconce"): a sconce's
// "velocity along `d` falls under a constant acceleration of `−SCONCE_DECEL`
// (`600`) units per second squared, integrated per tick as Projectiles and
// pierce states, position first and then velocity, so after `n` moving ticks
// its velocity is `(speed − SCONCE_DECEL × n × TICK_DT) × d`". Row 1 of
// `SCONCE_LEVELS` launches at speed `600`, and `30` moving ticks are
// `30 × TICK_DT` = `0.5` seconds, so the velocity after them is
// `(600 − 600 × 0.5) × d` = `300 × d`: half the launch speed, still along `d`
// and not yet reversed.
//
// WHY THE WORLD IS POSED AS IT IS. The requirement is one shape's flight, so
// the night holds one sconce and nothing else — no enemy, no weapon held, no
// second projectile — and `effectMotion` alone is turned back on, the switch
// `specs/instrumentation.md` gives the clause "Projectiles integrate ... and
// sconces decelerate", so the `30` ticks stepped are `30` moving ticks and
// nothing else in the world runs. The sconce is posed rather than launched
// because `spawnProjectile` gives it the launch's own figures ("A `sconce`
// takes acceleration `−SCONCE_DECEL` along the unit vector of `(vx, vy)`",
// `specs/instrumentation.md`), and a posed launch takes no enemy to aim at;
// its direction is `+x`, where the expected velocity is exact and the
// specification fixes no axis. Its ttl is row 1's `2.5` seconds, `150` ticks,
// so it is alive throughout.
//
// TOLERANCE. `POSITION_TOL` on each component of the velocity, a figure a
// build reaches by adding `SCONCE_DECEL × TICK_DT` thirty times, whose drift
// is of order `1e-13`; `1e-6` is seven orders under the `10` units per second
// one tick of the deceleration is worth.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { POSITION_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  mustProjectile,
  type Harness,
} from "../harness";
import { CENTER, LAUNCH_LINE, placeSconce, speedAfter } from "./stage";

/** The moving ticks stepped: half a second of flight. */
const TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a level-1 sconce at 300 along its launch direction after 30 moving ticks", async () => {
  await isolate(h);
  const posed = await placeSconce(h, CENTER, LAUNCH_LINE);
  await enable(h, "effectMotion");

  const ticks = await captureReplay(h, "slowing", () => h.stepWatching(TICKS));
  const sconce = mustProjectile(ticks[TICKS - 1]!, posed.id);

  assertNear(
    sconce.vx,
    speedAfter(TICKS) * LAUNCH_LINE.x,
    POSITION_TOL,
    "the sconce's velocity along its launch direction after 30 moving ticks",
  );
  assertNear(
    sconce.vy,
    speedAfter(TICKS) * LAUNCH_LINE.y,
    POSITION_TOL,
    "the sconce's velocity across its launch direction after 30 moving ticks",
  );
});
