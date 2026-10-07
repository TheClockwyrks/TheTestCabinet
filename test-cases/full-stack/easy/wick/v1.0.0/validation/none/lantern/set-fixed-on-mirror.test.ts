// Wick — lantern/set-fixed-on-mirror: a Mirror level gained mid-set leaves the
// set's count.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Lantern"): "A set is
// fixed when it is created: a Mirror level gained while a set lives leaves
// that set's count as it is". Row 1 of `LANTERN_LEVELS` carries amount `1` and
// duration `3.0`, so a level-1 set is one lantern that lives `180` ticks; Mirror
// at level 1 raises `amountBonus` to `1` (`specs/passives.md`), "read on the
// tick it fires". So a level-1 set of one lantern is still that one lantern on
// a tick after Mirror rose to 1 while it lived.
//
// THE POSE. An isolated night with Lantern held at level 1 and fired by one
// tick (`lantern/stage.ts`), then `weaponFire` off so nothing fires again;
// Mirror then held at level 1 through `setPassive`, which is how a level is
// posed, and thirty ticks run, well inside the set's `180`. The reading is the
// Lantern lanterns the snapshot holds: the one the firing created, and no
// other.
//
// TOLERANCE. None: the count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  disable,
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

/** The ticks run after the gain, inside the set's 180. */
const AFTER_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a level-1 set at one lantern after Mirror rises to 1 while it lives", async () => {
  await isolate(h);
  const firing = await fireWeapon(h, "lantern", LEVEL);
  await disable(h, "weaponFire");
  const created = lanternsOf(firing);
  assertEqual(created.length, 1, "the lantern the level-1 firing tick created");

  await holdPassive(h, "mirror", MIRROR_LEVEL);
  const later = await h.step(AFTER_TICKS);
  await captureStill(h, "fixed");

  assertEqual(
    passiveIn(later, "mirror")?.level,
    MIRROR_LEVEL,
    "the Mirror level held while the set lives",
  );
  assertDeepEqual(
    lanternsIn(later).map((lantern) => lantern.id),
    created.map((lantern) => lantern.id),
    `the Lantern lanterns ${AFTER_TICKS} ticks after Mirror rose to 1 mid-set`,
  );
});
