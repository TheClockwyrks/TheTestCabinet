// injector/projectile-speed — a fired core travels 620 units per second in a
// straight line along the angle it was fired at.
//
// WHERE THE THRESHOLD COMES FROM. specs/injector.md ("Flight"): "Each tick a
// projectile advances `PROJECTILE_SPEED` multiplied by the tick's elapsed time
// along its heading. The heading is fixed at firing and never turns, so a
// projectile travels in a straight line and neither accelerates nor slows."
// specs/injector.md ("Figures") fixes `PROJECTILE_SPEED` at 620 units/s and the
// injector's center at `(420, 330)`; specs/instrumentation.md fixes the tick at
// `1 / 60` s. So 30 ticks is exactly half a second and the travel it must cover
// is exactly `620 / 2 = 310` units, along the bearing the shot was released at.
// The review item's own figure, and its arithmetic.
//
// THE BEARING. `OPENING_AIM`, the 270 degrees specs/injector.md names as the
// aim's opening value, which specs/overview.md's convention makes straight up the
// field. From `(420, 330)` that leaves 330 units of field before the center
// crosses `y = 0`, so a shot within 6% of the stated speed is still in flight at
// the end of the window; a build fast enough to have left the field by then is
// caught by the reading below rather than by an exception.
//
// WHAT IS READ. The displacement between the projectile's position at release and
// its position 30 ticks later — its length, which is the speed, and its bearing,
// which is the direction of travel. Measuring the CHORD rather than the distance
// from the injector keeps this point about the flight alone: where a build places
// a fresh projectile is a different requirement, and a build that curved its shot
// would show a chord SHORTER than 310 for the same speed, so one length reading
// catches a curve as well as a wrong rate.
//
// THE HALL. Nothing stands on the channel at all. `specs/instrumentation.md`
// (`setEmission`) gates the inlet independently of the quota, so `poseHall`
// holds the inlet and leaves the quota where a level start leaves it: nothing
// arrives, and `specs/progression.md`'s clear — "the moment its quota is
// exhausted and no cores remain on the channel" — never fires on an unexhausted
// quota, so the screen stays `playing` over an EMPTY hall. Nothing this check
// reads can be disturbed by a bystander, because there is none.
// Nothing seats, so the flight runs undisturbed for the whole window.
//
// TOLERANCE. +/- 3 units on the 310-unit travel, the figure the review item
// states. Over a window of counted ticks the arithmetic is exact — 30 ticks of
// `PROJECTILE_SPEED * TICK_DT` is 310.000 units however a build accumulates it —
// so 3 units is a third of one tick's own 10.3-unit step and 0.97% of the stated
// speed, inside the case's standing +/- 2% for a speed measured over at least 30
// ticks (which here would be 6.2 units). The bearing takes `ANGLE_TOL`, the
// standing +/- 1 degree; over 310 units of travel that is 5 units of sideways
// drift, so a heading that turns at all is caught by it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertAngleNear, assertNear, fail } from "../assert";
import {
  ANGLE_TOL,
  OPENING_AIM,
  PROJECTILE_SPEED,
  PROJECTILE_TRAVEL_TOL,
  TICK_DT,
} from "../constants";
import {
  aimAt,
  captureReplay,
  createHarness,
  distance,
  poseHall,
  type Harness,
  type VoluteSnapshot,
} from "../harness";

/** The measured window: half a second, the case's minimum for a rate reading. */
const WINDOW_TICKS = 30;

/** What 30 ticks of `PROJECTILE_SPEED` cover: 310 units. */
const EXPECTED_TRAVEL = PROJECTILE_SPEED * TICK_DT * WINDOW_TICKS;

/** The one projectile the check released, or a failure naming what was missing. */
function shot(
  snapshot: VoluteSnapshot,
  when: string,
): { x: number; y: number } {
  const flying = snapshot.projectiles?.[0];
  if (flying === undefined) {
    fail(`a projectile in flight ${when}`, snapshot.projectiles);
  }
  return { x: flying.x, y: flying.y };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries a fired core 620 units per second along its firing angle", async () => {
  await poseHall(h, {});

  const flight = await captureReplay(h, "flight", async () => {
    h.debug.setAim(OPENING_AIM);
    h.debug.fire();
    const released = h.snapshot();
    const arrived = await h.step(WINDOW_TICKS);
    return { released, arrived };
  });

  const from = shot(flight.released, "the moment the shot was released");
  const to = shot(flight.arrived, `${WINDOW_TICKS} ticks after release`);

  assertEqual(
    flight.arrived.screen,
    "playing",
    "the screen the flight was driven on",
  );
  assertNear(
    distance(from, to),
    EXPECTED_TRAVEL,
    PROJECTILE_TRAVEL_TOL,
    `the units a shot covered in ${WINDOW_TICKS} ticks`,
  );
  assertAngleNear(
    aimAt(to, from),
    OPENING_AIM,
    ANGLE_TOL,
    "the bearing a shot fired at 270 degrees travelled on",
  );
});
