// Wick — flare/ignores-amount: Flare ignores amount, so Mirror adds no second
// burst and no second helping of damage.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Flare"): "Flare fires
// whether or not any enemy exists, and amount is ignored"; ("Amount") "A
// weapon's amount is the table amount plus `amountBonus`, read on the tick it
// fires. It counts the projectiles, puddles, strikes, or lanterns one firing
// produces. Halo and Flare ignore amount." `specs/passives.md` ("Amount"):
// "Halo, Corona, and Flare have no amount and ignore `amountBonus`", with
// `amountBonus = MIRROR_AMOUNT_PER_LEVEL × mirror`, `2` at Mirror 2. Row 1 of
// `FLARE_LEVELS` gives damage `100`, and ("Derived stats") a shape's damage is
// the "table value × `damageMul`", `1` with no Wick held, so the burst the
// firing tick creates carries `100` however much amount is held. A moth's `5`
// hp (`specs/enemies.md`, unscaled at a run clock of `0`) is under that, so it
// is gone on the firing tick.
//
// THE POSE. An isolated night with Mirror held at level 2, its maximum, one
// moth `100` along `+x` from the lamplighter and so inside the `640`, then
// Flare held at level 1 and its firing tick run through the shared
// `fireWeapon` (held, due, `weaponFire` on, one tick). `enemyMotion` and
// `enemyContact` stay held, so the moth stands where it was posed and hits
// nothing back.
//
// WHAT DECIDES "ONCE". The zones the firing tick created, which is exactly one
// burst, and the `damage` that burst carries, which `specs/instrumentation.md`
// ("Snapshot shape") defines as "the damage per hit the shape carries": a
// build that read `amountBonus` into Flare fires three bursts or carries three
// times the damage, and either reads off the tick.
//
// TOLERANCE. `FLOAT_TOL` on the burst's damage, a table figure times `1`; the
// burst count and the moth's fate are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { FLOAT_TOL, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  holdPassive,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";
import { FLARE, TARGET_OFFSET, assertBurned, oneBurst } from "./stage";

/** The level whose row is fired: damage `100`. */
const LEVEL = 1;

/** Row 1's damage, `100`. */
const DAMAGE = weaponRow(FLARE, LEVEL).damage;

/** Mirror's level, the passive's maximum: `amountBonus` `2`. */
const MIRROR_LEVEL = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates one burst carrying 100 and kills the moth inside it with Mirror 2 held", async () => {
  await isolate(h);
  await holdPassive(h, "mirror", MIRROR_LEVEL);
  const moth = await placeEnemy(h, "moth", TARGET_OFFSET, 0);

  const firing = await fireWeapon(h, FLARE, LEVEL);
  await captureStill(h, "one");

  const burst = oneBurst(
    firing.zones,
    `the firing tick with Mirror ${MIRROR_LEVEL} held`,
  );
  assertNear(
    burst.damage,
    DAMAGE,
    FLOAT_TOL,
    `the burst's damage with Mirror ${MIRROR_LEVEL} held`,
  );
  assertBurned(
    firing.after,
    moth,
    DAMAGE,
    `the moth inside the burst with Mirror ${MIRROR_LEVEL} held`,
  );
});
