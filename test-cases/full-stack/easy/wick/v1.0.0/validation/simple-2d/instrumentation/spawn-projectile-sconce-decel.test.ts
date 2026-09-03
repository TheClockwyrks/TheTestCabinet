// instrumentation/spawn-projectile-sconce-decel — `spawnProjectile('sconce',
// 0, 0, 0, 600, -1)` reads acceleration (0, −600), and a posed ember, pin,
// shard, beacon, or hail reads (0, 0).
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `spawnProjectile`:
// "A `sconce` takes acceleration `−SCONCE_DECEL` along the unit vector of
// `(vx, vy)` ... every other weapon takes `(0, 0)`"; SCONCE_DECEL is 600
// (specs/weapons.md).
//
// THE POSE. An isolated run, the six weapons posed in turn, each read back
// without a frame at FIGURE_TOLERANCE.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, SCONCE_DECEL } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  projectileById,
  type Harness,
} from "../harness";
import type { ProjectileWeapon } from "../surface";

const OTHERS: readonly ProjectileWeapon[] = [
  "ember",
  "pin",
  "shard",
  "beacon",
  "hail",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives a sconce its deceleration and the others none", async () => {
  isolate(h);

  const sconceId = h.snapshot().run.nextId;
  h.debug.spawnProjectile("sconce", 0, 0, 0, 600, -1);
  const sconce = projectileById(h.snapshot(), sconceId);
  assertDefined(sconce, "the posed sconce");
  assertWithin(
    sconce?.ax ?? Number.NaN,
    0,
    FIGURE_TOLERANCE,
    "the sconce's ax",
  );
  assertWithin(
    sconce?.ay ?? Number.NaN,
    -SCONCE_DECEL,
    FIGURE_TOLERANCE,
    "the sconce's ay",
  );

  for (const weapon of OTHERS) {
    const id = h.snapshot().run.nextId;
    h.debug.spawnProjectile(weapon, 200, 0, 0, 600, 1);
    const shot = projectileById(h.snapshot(), id);
    assertDefined(shot, `the posed ${weapon}`);
    assertWithin(
      shot?.ax ?? Number.NaN,
      0,
      FIGURE_TOLERANCE,
      `the ${weapon}'s ax`,
    );
    assertWithin(
      shot?.ay ?? Number.NaN,
      0,
      FIGURE_TOLERANCE,
      `the ${weapon}'s ay`,
    );
  }
  await h.tick(1);
  captureStill(h, "decel");
});
