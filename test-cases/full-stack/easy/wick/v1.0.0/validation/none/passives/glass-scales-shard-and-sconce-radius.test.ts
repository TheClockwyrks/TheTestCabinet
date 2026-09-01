// Wick — passives/glass-scales-shard-and-sconce-radius: `areaMul` scales a
// shard's and a sconce's collision radius.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): the table names
// "Shard, Sconce | bolt `radius`" among the lengths `areaMul` scales, over
// "`areaMul = 1 + GLASS_AREA_PER_LEVEL × glass`" with `GLASS_AREA_PER_LEVEL`
// (`0.1`). Row 1 of `SHARD_LEVELS` carries radius `8` and row 1 of
// `SCONCE_LEVELS` carries radius `12` (`specs/weapons.md`), so with Glass at
// level 2 a shard reads `9.6` and a sconce reads `14.4`.
//
// THE POSE. An isolated night with Glass 2 held through `setPassive`, and Shard
// and Sconce held at level 1 and fired by one tick together. Sconce "needs at
// least one enemy to fire", so one hound stands `FAR` (`5000`) units along
// `+x`, past every reach either shape has, and Shard aims at the same nearest
// enemy. Every other faculty stays held, so nothing travels, nothing bounces,
// and nothing else fires: the reading is the two projectiles the tick created.
//
// TOLERANCE. `FLOAT_TOL` on each radius, a table figure times exactly `1.2`.
// The unscaled `8` and `12` are more than a unit from either.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, areaMul, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";
import { fireVolley, placeFarTarget, shotsOf } from "./stage";

/** The Glass level held: `areaMul` `1.2`. */
const GLASS_LEVEL = 2;

/** The level both weapons are held at. */
const LEVEL = 1;

/** The scale every length the rows give passes through. */
const SCALE = areaMul({ glass: GLASS_LEVEL });

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads radius 9.6 on a level-1 shard and 14.4 on a level-1 sconce with Glass 2 held", async () => {
  await isolate(h);
  await holdPassive(h, "glass", GLASS_LEVEL);
  await placeFarTarget(h, "hound");

  const volley = await fireVolley(h, [
    { id: "shard", level: LEVEL },
    { id: "sconce", level: LEVEL },
  ]);
  await captureStill(h, "shard");

  const shards = shotsOf(volley, "shard");
  assertEqual(shards.length, 1, "shards the firing tick created");
  assertNear(
    shards[0]!.radius,
    (weaponRow("shard", LEVEL).radius ?? NaN) * SCALE,
    FLOAT_TOL,
    "the shard's radius with Glass 2 held",
  );

  const sconces = shotsOf(volley, "sconce");
  assertEqual(sconces.length, 1, "sconces the firing tick created");
  assertNear(
    sconces[0]!.radius,
    (weaponRow("sconce", LEVEL).radius ?? NaN) * SCALE,
    FLOAT_TOL,
    "the sconce's radius with Glass 2 held",
  );
});
