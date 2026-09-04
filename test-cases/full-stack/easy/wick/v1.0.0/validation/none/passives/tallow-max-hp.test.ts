// Wick — passives/tallow-max-hp: Tallow adds `15` to `maxHp` per level, and a
// heal fills to the raised maximum.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("The derived stats"):
// "`maxHp = BASE_MAX_HP + TALLOW_HP_PER_LEVEL × tallow`" with `BASE_MAX_HP`
// (`100`) and `TALLOW_HP_PER_LEVEL` (`15`), so Tallow at level 3 gives `145`;
// ("Max health") "Every heal and every recovery tick caps `hp` at the `maxHp`
// in force when it is applied." `specs/world.md` ("Pickups") has bread heal
// "`BREAD_HEAL` (`30`), capped at `maxHp`", so from `hp` `100` one bread
// carries `hp` to `130` and a second to `145` rather than `160`.
//
// THE POSE. An isolated night with Tallow 3 placed through `setPassive`, which
// "leaves `hp` untouched" so `hp` stands at the `100` the run began with, and
// two breads collected through the real path: a pickup posed at the
// lamplighter's center and the tick that collects it, twice. Every faculty
// stays held, so no enemy hits and no recovery runs (`BASE_RECOVERY` is `0`
// with no Tinder held), and nothing but the two heals moves `hp`.
//
// TOLERANCE. `FLOAT_TOL` on the maximum and on `hp`, whole numbers the formulas
// give exactly. The unraised `100` is forty-five units from the second reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { FLOAT_TOL, maxHpOf } from "../constants";
import {
  captureStill,
  collectPickup,
  createHarness,
  holdPassive,
  isolate,
  player,
  type Harness,
} from "../harness";

/** The Tallow level held: `maxHp` `145`. */
const TALLOW_LEVEL = 3;

/** `100 + 15 × 3`. */
const EXPECTED_MAX = maxHpOf({ tallow: TALLOW_LEVEL });

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads maxHp 145 with Tallow 3 held and lets two breads carry hp to 145", async () => {
  await isolate(h);
  await holdPassive(h, "tallow", TALLOW_LEVEL);
  const posed = await h.snapshot();
  assertNear(
    posed.run.maxHp,
    EXPECTED_MAX,
    FLOAT_TOL,
    "the maxHp reported with Tallow 3 held",
  );

  // Two breads, because `BREAD_HEAL` (`30`) twice is `160` and the cap is what
  // is being read; what the first one left is recovery's requirement, not this
  // one, so only the second reading is asserted.
  await collectPickup(h, "bread");
  const twice = await collectPickup(h, "bread");
  await captureStill(h, "max");
  assertNear(
    player(twice).hp,
    EXPECTED_MAX,
    FLOAT_TOL,
    "hp after a second bread, capped at the raised maximum",
  );
});
