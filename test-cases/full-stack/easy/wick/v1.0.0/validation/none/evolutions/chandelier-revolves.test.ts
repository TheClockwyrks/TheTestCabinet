// Wick — evolutions/chandelier-revolves: the set revolves at
// `LANTERN_ANGULAR_SPEED` and rides a circle centered on the lamplighter.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Chandelier"): the
// lanterns are created "on a circle of radius `orbit` centered on the player's
// center, lantern `i`, counted from `0`, at angle `i × 360 / amount`", and
// "From the next tick they revolve at `LANTERN_ANGULAR_SPEED` (`180`) degrees
// per second clockwise, the circle they ride centered on the player's center
// every tick". `specs/weapons.md` ("The nearest enemy"): "positive angles
// turning toward `+y`, which is clockwise on screen". So the lantern that stood
// at `0` on the placing tick sits at `0 + 180 × 30 / 60 = 90` degrees `30` ticks
// later, straight below the lamplighter; a build that also turned it on the
// placing tick would read `93`, and one turning the other way `270`.
// `specs/world.md` (phase 5) has "each lantern's center ... placed about the
// lamplighter's position of this tick", so on the tick after the lamplighter is
// moved every lantern stands `orbit` (`120`, times an `areaMul` of `1`) from
// the new center.
//
// THE POSE. An isolated night with `effectMotion` on, the switch under which
// "lanterns revolve" (`specs/instrumentation.md`), and nothing else: no enemy,
// no other weapon, `weaponFire` off. Chandelier is held and one tick places the
// set; the lantern standing at `0` on that tick is picked out by id, so the turn
// is read on the same lantern rather than on whichever one happens to be there
// after. Then thirty ticks, then the lamplighter is moved with
// `setPlayerPosition` and one more tick re-centers the circle.
//
// TOLERANCE. `ANGLE_TOL` on the angle recovered from a lantern's center;
// `POSITION_TOL` on each distance from the lamplighter's center.

import { afterEach, beforeEach, it } from "vitest";
import { assertAngleNear, assertEqual, fail } from "../assert";
import {
  ANGLE_TOL,
  LANTERN_ANGULAR_SPEED,
  TICK_DT,
  weaponRow,
} from "../constants";
import {
  angleFrom,
  captureReplay,
  createHarness,
  isolate,
  mustZone,
  player,
  type Harness,
} from "../harness";
import { assertOnOrbit, chandelierLanterns, placeChandelierSet } from "./stage";

/** Chandelier's fixed row, `CHANDELIER_STATS`. */
const ROW = weaponRow("chandelier");

/** Half a second of revolution. */
const TURN_TICKS = 30;

/** Where the lantern that started at `0` sits after the turn: `180 × 30 / 60`. */
const TURNED_ANGLE = LANTERN_ANGULAR_SPEED * TURN_TICKS * TICK_DT;

/** Where the lamplighter walks to, so the circle must follow. */
const MOVED_TO = { x: 400, y: 260 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns the lantern that started at 0 to 90 degrees over 30 ticks and re-centers the circle on the moved lamplighter", async () => {
  await isolate(h, { on: ["effectMotion"] });

  const drive = await captureReplay(h, "revolving", async () => {
    const set = await placeChandelierSet(h);
    const center = player(set.after);
    const first = set.lanterns.find(
      (lantern) =>
        angleFrom(center, lantern) <= ANGLE_TOL ||
        360 - angleFrom(center, lantern) <= ANGLE_TOL,
    );
    if (first === undefined) {
      fail(
        "a Chandelier lantern at 0 degrees on the placing tick",
        set.lanterns.map((lantern) => angleFrom(center, lantern)),
      );
    }
    const turned = await h.step(TURN_TICKS);
    await h.debug.setPlayerPosition(MOVED_TO.x, MOVED_TO.y);
    const moved = await h.step(1);
    return { set, first, turned, moved };
  });

  assertEqual(
    drive.set.lanterns.length,
    ROW.amount,
    "Chandelier lantern zones the placing tick created",
  );
  assertEqual(
    drive.turned.run.tick - drive.set.after.run.tick,
    TURN_TICKS,
    "the ticks stepped after the placing tick",
  );
  assertAngleNear(
    angleFrom(player(drive.turned), mustZone(drive.turned, drive.first.id)),
    TURNED_ANGLE,
    ANGLE_TOL,
    `the lantern's angle ${TURN_TICKS} ticks after the placing tick`,
  );
  assertOnOrbit(
    chandelierLanterns(drive.moved),
    player(drive.moved),
    ROW.orbit ?? NaN,
    "the set on the tick after the lamplighter moved",
  );
});
