// injector/cooldown-blocks — a fire input raised inside the cooldown produces no
// projectile.
//
// WHERE THE THRESHOLD COMES FROM. specs/injector.md ("Firing"): "The injector
// carries one cooldown timer. A fire input is honored when the timer has expired:
// a projectile appears ... and the timer is set to `FIRE_COOLDOWN`. A fire input
// while the timer is unexpired produces no projectile and leaves the timer
// alone." specs/injector.md ("Figures") fixes `FIRE_COOLDOWN` at 0.18 s, which
// specs/instrumentation.md's tick of `1 / 60` s makes 10.8 ticks.
//
// WHY THE FIRE CONTROL AND NOT `fire()`. specs/instrumentation.md's `fire` says
// "Any cooldown outstanding at the call is cleared first, so the call always
// launches" — it cannot express this requirement. So the first shot is released
// through `fire`, which sets the timer "as a played shot sets it", and both
// attempts after it are the `fire` action, which `src/constants.ts` binds to
// `Space` and specs/controls.md ("Actions") makes the one that "fires the loaded
// core along the aim" — the input the rule is about.
//
// WHERE THE PRESSES LAND, AND WHY THERE. specs/channel.md's tick order runs every
// timer down at step 1 and never says where an input is consumed within a tick,
// so on the tick a press runs, the cooldown already spent is either the ticks
// before that one or those ticks plus it. Each press is placed so that BOTH
// readings answer the same way for every cooldown the case's standing +/- 2
// ticks on a duration admits, which is the band 0.1467 s to 0.2133 s:
//   - the refused press runs the 8th tick after the shot, so at most 0.1333 s of
//     the cooldown has been spent — short of the shortest cooldown the tolerance
//     admits, so every build inside the band refuses it;
//   - the honored press runs the 14th, so at least 0.2167 s has been spent —
//     past the longest the tolerance admits, so every build inside the band
//     honors it.
// Those are as close to 0.18 s as whole ticks allow without failing a build the
// case's own tolerance calls conformant. The band this point therefore cannot
// tell apart from 0.18 s is (0.1167 s, 0.2333 s]: three ticks either side, which
// is the standing two plus the one the tick order leaves open, and it is the
// floor for any check that steps whole ticks.
// A build with the rule inverted, or with no cooldown at all, fails the first
// reading; the second reading is the control that stops a build whose fire
// control does nothing at all from passing this point by refusing everything.
//
// THE HALL. Nothing stands on the channel at all. `specs/instrumentation.md`
// (`setEmission`) gates the inlet independently of the quota, so `poseHall`
// holds the inlet and leaves the quota where a level start leaves it: nothing
// arrives, and `specs/progression.md`'s clear — "the moment its quota is
// exhausted and no cores remain on the channel" — never fires on an unexhausted
// quota, so the screen stays `playing` over an EMPTY hall. Nothing this check
// reads can be disturbed by a bystander, because there is none.
// Nothing seats, so the count of projectiles is the whole reading. Both shots run
// due `-y` from `(420, 330)` and leave the field 31.9 ticks after release, so
// both are still in flight when the counts are read.
//
// TOLERANCE. None to pick: the reading is a count of projectiles, which the case
// grades exactly. The tolerance is spent on WHERE the two presses are placed,
// above.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { OPENING_AIM } from "../constants";
import {
  captureReplay,
  createHarness,
  poseHall,
  pressFire,
  type Harness,
} from "../harness";

/** Ticks stepped before the refused press, whose own tick makes eight. */
const INSIDE_TICKS = 7;

/** Ticks stepped between the two presses, taking the second to tick fourteen. */
const GAP_TICKS = 5;

/** Ticks stepped after the honored press, so the replay shows both shots fly. */
const TRAIL_TICKS = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a shot inside the cooldown and honors one after it", async () => {
  await poseHall(h, {});

  const fired = await captureReplay(h, "denied", async () => {
    h.debug.setAim(OPENING_AIM);
    h.debug.fire();
    await h.step(INSIDE_TICKS);
    const refused = await pressFire(h);
    await h.step(GAP_TICKS);
    const honored = await pressFire(h);
    await h.step(TRAIL_TICKS);
    return { refused, honored };
  });

  assertEqual(
    fired.refused.screen,
    "playing",
    "the screen the fire control was raised on",
  );
  assertEqual(
    fired.refused.projectiles.length,
    1,
    "projectiles after a fire input at most 0.133 s into the 0.18 s cooldown",
  );
  assertEqual(
    fired.honored.projectiles.length,
    2,
    "projectiles after a fire input at least 0.217 s after the first shot",
  );
});
