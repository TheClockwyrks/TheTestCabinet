// Wick — spark/hits-landing-tick-only: a strike damages nothing after the
// tick it lands.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Spark"): "A strike
// deals `damage` to its target and to every other enemy within `area` of the
// target's center, on the tick it lands", and "The strike is drawn for
// `SPARK_FLASH` (`0.2`) seconds and has no hitbox after the tick it lands."
// So on the tick after the landing a zone may still be in `zones` to be
// tested against, and the specification says its circle hits nothing.
//
// THE POSE. Spark at level 1 fires on an isolated night with a hound at
// `(200, 0)`, the one enemy in range and so the target, and a moth at
// `(700, 0)`, beyond the range and `500` from the strike's center, so the
// firing tick lands on the hound and leaves the moth at its `5`. After that
// tick the moth is moved onto the strike's own center, `(200, 0)`, by
// `setEnemyPosition` (`specs/instrumentation.md`: "Moves enemy `id` to
// `(x, y)`; its heading, age, and health are untouched"), and one more tick
// runs. `weaponFire` is turned off first, so nothing new fires on that tick
// and the only shape the moth could meet is the strike of the tick before;
// a zone's ttl counts and its hits resolve whatever the switches hold
// (`specs/instrumentation.md`, "The driver switches").
//
// TOLERANCE. None: the moth is present at its posed hp, or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SPARK_RANGE, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  disable,
  fireWeapon,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";
import {
  SPARK,
  TARGET_RING,
  assertCenteredOn,
  assertStruck,
  assertUntouched,
  strikesOf,
} from "./stage";

/** The level whose strike is read. */
const LEVEL = 1;

/** The target: the one enemy in range. */
const TARGET = { x: TARGET_RING, y: 0 };

/** Where the moth waits out the firing tick: beyond the range. */
const CLEAR = { x: SPARK_RANGE + 100, y: 0 };

/** Row 1's damage, `15`. */
const DAMAGE = weaponRow(SPARK, LEVEL).damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a moth moved onto the strike's center on the tick after the landing untouched", async () => {
  await isolate(h);
  const hound = await placeEnemy(h, "hound", TARGET.x, TARGET.y);
  const moth = await placeEnemy(h, "moth", CLEAR.x, CLEAR.y);

  const firing = await fireWeapon(h, SPARK, LEVEL);
  const strikes = strikesOf(firing.zones);
  assertEqual(
    strikes.length,
    1,
    "Spark strike zones the firing tick created with one enemy in range",
  );
  assertCenteredOn(strikes[0]!, TARGET, "the strike on the hound");
  assertStruck(firing.after, hound, DAMAGE, "the hound on the landing tick");
  assertUntouched(firing.after, moth, "the moth clear of the landing tick");

  await disable(h, "weaponFire");
  await h.debug.setEnemyPosition(moth.id, TARGET.x, TARGET.y);
  const next = await h.step(1);
  await captureStill(h, "once");

  assertUntouched(
    next,
    moth,
    "the moth on the strike the tick after it landed",
  );
});
