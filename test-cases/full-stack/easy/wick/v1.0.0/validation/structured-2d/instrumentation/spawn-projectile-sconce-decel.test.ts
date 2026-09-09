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
// pin, shard, beacon, and hail, all read at the call.
//
// THE TOLERANCE. `REAL_EPS`: the specification fixes the direction as the unit
// vector of `(vx, vy)` and leaves how that vector is formed to the build, so a
// component that is exactly `0` in the statement may reach the snapshot as a
// rounding residue of the normalisation — `-cos(π/2) * 600` rather than `0`.
// A billionth is orders above any such residue and orders below the smallest
// acceleration a build could mistakenly apply; the other weapons' `(0, 0)` is
// read the same way.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertNear } from "../assert";
import { REAL_EPS, SCONCE_DECEL } from "../constants";
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
  assertNear(sconce?.ax ?? Number.NaN, 0, REAL_EPS, "the sconce's ax");
  assertNear(
    sconce?.ay ?? Number.NaN,
    -SCONCE_DECEL,
    REAL_EPS,
    "the sconce's ay",
  );

  for (const weapon of OTHERS) {
    const otherId = placeProjectile(h, weapon, 0, 0, 0, 600, 0);
    const other = projectileById(h.snapshot(), otherId);
    assertDefined(other, `the posed ${weapon}`);
    assertNear(other?.ax ?? Number.NaN, 0, REAL_EPS, `the ${weapon}'s ax`);
    assertNear(other?.ay ?? Number.NaN, 0, REAL_EPS, `the ${weapon}'s ay`);
  }
  await h.frameDraw();
  captureStill(h, "decel");
});
