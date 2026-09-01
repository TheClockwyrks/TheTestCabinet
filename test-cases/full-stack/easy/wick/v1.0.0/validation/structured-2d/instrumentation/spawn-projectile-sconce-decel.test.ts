// Wick — instrumentation/spawn-projectile-sconce-decel: a posed sconce reads
// acceleration `−SCONCE_DECEL` along its launch direction, and every other
// posed projectile reads (0, 0).
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `spawnProjectile(...)`: "A `sconce` takes acceleration `−SCONCE_DECEL` along
// the unit vector of `(vx, vy)` ... every other weapon takes `(0, 0)`";
// `SCONCE_DECEL` is 600, so a sconce launched along +y reads (0, −600).
//
// THE POSES. An isolated run, one sconce flying +y and one each of ember,
// pin, shard, beacon, and hail, all read at the call. Exact: a stated figure
// along a unit axis.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual } from "../assert";
import { SCONCE_DECEL } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeProjectile,
  projectileById,
  type Harness,
  type ProjectileWeapon,
} from "../harness";

const OTHERS: ProjectileWeapon[] = ["ember", "pin", "shard", "beacon", "hail"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("gives a sconce its deceleration and every other weapon none", async () => {
  isolate(h);
  const sconceId = placeProjectile(h, "sconce", 0, 0, 0, 600, -1);
  const sconce = projectileById(h.snapshot(), sconceId);
  assertDefined(sconce, "the posed sconce");
  assertEqual(sconce?.ax, 0, "the sconce's ax");
  assertEqual(sconce?.ay, -SCONCE_DECEL, "the sconce's ay");

  for (const weapon of OTHERS) {
    const otherId = placeProjectile(h, weapon, 0, 0, 0, 600, 0);
    const other = projectileById(h.snapshot(), otherId);
    assertDefined(other, `the posed ${weapon}`);
    assertEqual(other?.ax, 0, `the ${weapon}'s ax`);
    assertEqual(other?.ay, 0, `the ${weapon}'s ay`);
  }
  await h.frameDraw();
  captureStill(h, "decel");
});
