// Wick — lantern/next-set-reads-amount: the next firing reads the new amount.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Lantern"): "a Mirror
// level gained while a set lives leaves that set's count as it is, and the
// next firing reads the new amount"; ("Amount") "A weapon's amount is the
// table amount plus `amountBonus`, read on the tick it fires". Row 1 of
// `LANTERN_LEVELS` carries amount `1`, and Mirror at level 1 gives an
// `amountBonus` of `1` (`specs/passives.md`), so the next firing after the
// gain creates `1 + 1 = 2` lanterns.
//
// THE POSE. An isolated night with Lantern held at level 1 and fired by one
// tick (`lantern/stage.ts`), then `weaponFire` off; Mirror held at level 1
// through `setPassive` while that set still stands, which is what makes the
// gain a mid-set one. The set is then taken out of the world by `clearZones`,
// the operation that "removes every zone" (`specs/instrumentation.md`), rather
// than by waiting out its `ttl`: how long a set lives is the duration point's
// requirement and what a mid-set gain does to a live set is the fixed-set
// point's, so a build that holds either wrong fails those points and reaches
// this one on its own terms. Lantern's timer is then set to `0` through
// `setWeaponCooldown` and `weaponFire` turned on for the one tick that fires it
// again, so the next firing is reached without waiting on the timer, which is
// its own point. The reading is the lanterns standing after that tick, on a
// field the clear left empty.
//
// TOLERANCE. None: the count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { weaponRow } from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  disable,
  enable,
  fireWeapon,
  holdPassive,
  isolate,
  passiveIn,
  type Harness,
} from "../harness";
import { lanternsIn, lanternsOf } from "./stage";

/** The level fired: a set of one. */
const LEVEL = 1;

/** The Mirror level gained mid-set. */
const MIRROR_LEVEL = 1;

const ROW = weaponRow("lantern", LEVEL);

/** What the next firing creates: the table amount plus Mirror's bonus. */
const NEXT_AMOUNT = (ROW.amount ?? 0) + MIRROR_LEVEL;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates two lanterns on the firing after a level-1 set with Mirror 1 gained mid-set is gone", async () => {
  await isolate(h);
  const firing = await fireWeapon(h, "lantern", LEVEL);
  await disable(h, "weaponFire");
  assertEqual(
    lanternsOf(firing).length,
    ROW.amount,
    "the lanterns the level-1 firing tick created",
  );

  await holdPassive(h, "mirror", MIRROR_LEVEL);
  const gained = await h.snapshot();
  assertEqual(
    passiveIn(gained, "mirror")?.level,
    MIRROR_LEVEL,
    "the Mirror level held while the set lives",
  );
  assertGreaterThan(
    lanternsIn(gained).length,
    0,
    "the lanterns standing when Mirror was gained, which is what makes it a mid-set gain",
  );

  await h.debug.clearZones();
  const cleared = await h.snapshot();
  assertEqual(
    lanternsIn(cleared).length,
    0,
    "Lantern lanterns left once the set was cleared",
  );

  await armWeapon(h, firing.slot);
  await enable(h, "weaponFire");
  const next = await h.step(1);
  await captureStill(h, "next");

  assertEqual(
    lanternsIn(next).length,
    NEXT_AMOUNT,
    "Lantern lanterns standing after the next firing tick with Mirror 1 held",
  );
});
