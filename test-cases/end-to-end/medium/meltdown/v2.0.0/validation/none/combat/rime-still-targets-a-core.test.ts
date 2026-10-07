// Meltdown — combat/rime-still-targets-a-core: an immune unit is an ordinary
// target.
//
// `specs/combat.md`: "A unit immune to slowing is an ordinary target: it is chosen
// and fired on under the rule above like any other unit." So the Core's immunity
// (`specs/surge.md` marks it `Slowable: no`) is about what a shot DOES to it, never
// about whether the shot is taken.
//
// THIS IS THE HALF A BUILD DROPS ON THE WAY TO THE OTHER ONE. Having read that the
// Core cannot be slowed, the shortest way to honour it is to skip the unit in the
// Rime's targeting — at which point the boss walks past every Rime on the floor
// untouched, `combat/core-is-immune-to-slowing` passes, and nothing else in the
// group notices. So this point poses a Core as the only unit in range of a Rime and
// asserts the two things that say the Rime treated it as a target: `targeting` names
// it, and its hp falls.
//
// THE HP READING IS THE LOAD-BEARING ONE. A build could name the Core in `targeting`
// and decline to resolve a shot at it, so the drive runs half an interval past the
// first shot and reads what came off.
//
// ONE UNIT ON AN EMPTY FLOOR, so `targeting` names the Core or it names nothing, and
// there is no second unit whose `remaining` could be the reason for either answer.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  framesForShots,
  type Harness,
} from "../harness";
import {
  NEAR_UNITS,
  fireRateOf,
  poseGun,
  poseMarkEast,
  readGun,
  readHp,
} from "./duel";

/** The one emitter whose effect the Core is immune to, at level I, pinned cold. */
const TOWER = "rime";
const LEVEL = 1;
const HEAT = 0;
const MARK = "core";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("The Rime still targets a Core", async () => {
  const gunId = await poseGun(h, TOWER, HEAT, LEVEL);
  const mark = await poseMarkEast(h, TOWER, MARK, NEAR_UNITS);
  const opened = await readHp(h, mark);

  await h.advance(framesForShots(1, fireRateOf(TOWER, LEVEL)));
  await captureStill(h, "targeting");
  const gun = await readGun(h, gunId, `the ${TOWER} with a ${MARK} in range`);

  assertEqual(
    gun.targeting,
    mark,
    `the unit a ${TOWER} targeted with an immune ${MARK} the only unit in range`,
  );
  assertGreaterThan(
    opened - (await readHp(h, mark)),
    0,
    `hp the ${TOWER} removed from the ${MARK}, after one ` +
      `${(1 / fireRateOf(TOWER, LEVEL)).toFixed(4)}s interval`,
  );
});
