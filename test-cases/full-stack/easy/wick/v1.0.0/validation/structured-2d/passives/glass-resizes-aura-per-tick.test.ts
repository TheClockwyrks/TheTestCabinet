// passives/glass-resizes-aura-per-tick — the aura's radius follows `areaMul`
// on every tick, not only the tick it was created on.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`, Area: "A shape's
// lengths are fixed when it is created, with one exception: the Halo and
// Corona aura's radius and a Chandelier lantern's orbit and radius are
// recomputed on every tick from the level and `areaMul` in force on that
// tick." `specs/weapons.md` (Halo) says the same of the zone itself. Halo's
// level-1 row gives `radius` `80`, so with no passive held `areaMul` is `1`
// and the aura reads `80`; Glass 2 makes `areaMul` `1.2`, so the tick after
// the level is gained the same aura reads `96`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Halo at level 1
// alone, with no passive and no enemy: Halo needs no target, so nothing is
// hit, and the aura is the only zone in the world. The aura is created by the
// placement part of phase 5, which "runs on every `playing` tick, whatever the
// two hold" (`specs/instrumentation.md`), so one tick makes it and one more
// tick after the Glass level is all that is watched.
//
// THE TOLERANCE. `REAL_EPS` on each radius, one table figure times one
// multiplier; the two figures are sixteen units apart, so a build that fixed
// the radius at creation reports `80` where `96` is required.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { HALO_LEVELS, REAL_EPS, areaMul } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  holdPassive,
  type Harness,
  zonesOfKind,
} from "../harness";
import { fireUnder } from "./firing";

/** The Glass level gained while the aura is already in the world. */
const GLASS_LATER = 2;

/** The radius Halo's level-1 `80` carries with no passive held. */
const UNSCALED = HALO_LEVELS[0].radius;

/** The radius the same row carries under Glass 2: `96`. */
const SCALED = UNSCALED * areaMul(GLASS_LATER);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads the level-1 Halo aura at radius 80 and at 96 on the tick after Glass rises to 2", async () => {
  const firing = await fireUnder(h, { weapons: [["halo", 1]] });

  const before = zonesOfKind(firing.after, "aura");
  assertEqual(
    before.length,
    1,
    "the aura zones held while Halo is held (specs/weapons.md, Halo)",
  );
  assertNear(
    before[0].radius,
    UNSCALED,
    REAL_EPS,
    "the aura's radius with no passive held (specs/weapons.md, Halo)",
  );

  holdPassive(h, "glass", GLASS_LATER);
  const later = await advanceTicks(h, 1);
  captureStill(h, "resized");

  const after = zonesOfKind(later, "aura");
  assertEqual(
    after.length,
    1,
    "the aura zones held after Glass rose to 2 (specs/weapons.md, Halo)",
  );
  assertNear(
    after[0].radius,
    SCALED,
    REAL_EPS,
    "the aura's radius on the tick after Glass rose to 2 (specs/passives.md, Area)",
  );
});
