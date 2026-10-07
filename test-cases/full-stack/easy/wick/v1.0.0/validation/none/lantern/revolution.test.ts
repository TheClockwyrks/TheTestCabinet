// Wick — lantern/revolution: a lantern revolves at `LANTERN_ANGULAR_SPEED`
// clockwise.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Lantern"): "lantern
// `i`, counted from `0`, starts at angle `i × 360 / amount`" and "From the
// next tick they revolve at `LANTERN_ANGULAR_SPEED` (`180`) degrees per second
// clockwise, so lantern `i` sits at angle `i × 360 / amount +
// LANTERN_ANGULAR_SPEED × t` after `t` seconds"; ("The nearest enemy")
// "positive angles turning toward `+y`, which is clockwise on screen". A
// level-1 set is one lantern starting at `0`, and `30` ticks are `0.5`
// seconds, so after them it sits at `0 + 180 × 0.5 = 90` degrees: straight
// below the lamplighter, at `+y`. A build that also turned it on the firing
// tick would read `93`, and one turning the other way `270`.
//
// THE POSE. An isolated night with `effectMotion` on, the switch under which
// "lanterns revolve" (`specs/instrumentation.md`); Lantern held at level 1 and
// fired by one tick, then `weaponFire` off so the thirty ticks that follow turn
// the lantern and nothing else. The angle the firing tick left is read first,
// so a set that started elsewhere fails on that reading rather than on the
// turn. The replay covers the thirty ticks of the turn.
//
// TOLERANCE. `ANGLE_TOL` on the angle recovered from the lantern's center.

import { afterEach, beforeEach, it } from "vitest";
import { assertAngleNear, assertEqual } from "../assert";
import { ANGLE_TOL, LANTERN_ANGULAR_SPEED, TICK_DT } from "../constants";
import {
  angleFrom,
  captureReplay,
  createHarness,
  disable,
  fireWeapon,
  isolate,
  mustZone,
  player,
  type Harness,
} from "../harness";
import { lanternsOf } from "./stage";

/** The level fired: one lantern, starting at `0`. */
const LEVEL = 1;

/** Half a second of revolution, one tick at a time. */
const TURN_TICKS = 30;

/** Where the lantern sits after the turn: `0 + 180 × 30 / 60` = `90`. */
const TURNED_ANGLE = LANTERN_ANGULAR_SPEED * TURN_TICKS * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns a level-1 lantern from 0 to 90 degrees over 30 ticks with effectMotion on", async () => {
  await isolate(h, { on: ["effectMotion"] });
  const firing = await fireWeapon(h, "lantern", LEVEL);
  await disable(h, "weaponFire");

  const lanterns = lanternsOf(firing);
  assertEqual(
    lanterns.length,
    1,
    "the lantern the level-1 firing tick created",
  );
  const lantern = lanterns[0]!;
  assertAngleNear(
    angleFrom(player(firing.after), lantern),
    0,
    ANGLE_TOL,
    "the lantern's angle on the tick it was created",
  );

  const turned = await captureReplay(h, "revolving", () => h.step(TURN_TICKS));

  assertEqual(
    turned.run.tick - firing.after.run.tick,
    TURN_TICKS,
    "the ticks stepped after the firing",
  );
  assertAngleNear(
    angleFrom(player(turned), mustZone(turned, lantern.id)),
    TURNED_ANGLE,
    ANGLE_TOL,
    `the lantern's angle ${TURN_TICKS} ticks after the firing`,
  );
});
