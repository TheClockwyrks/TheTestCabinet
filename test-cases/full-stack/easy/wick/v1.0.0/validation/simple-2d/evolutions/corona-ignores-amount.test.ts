// Wick — evolutions/corona-ignores-amount: Corona ignores `amountBonus`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Corona"): "one zone of kind `aura`", and "each
//     pulse deals `damage` to every enemy whose circle overlaps the aura, and
//     amount is ignored."
//   - `specs/passives.md` ("Amount"): "Halo, Corona, and Flare have no amount
//     and ignore `amountBonus`", and `amountBonus` is `MIRROR_AMOUNT_PER_LEVEL`
//     (`1`) per Mirror level, so Mirror at its `maxLevel` of `2` gives a bonus
//     of 2 and a build that read it into Corona would stand three auras or
//     strike three times.
//   - `specs/evolutions.md` ("Corona"), the fixed row: damage `12`, radius
//     `150`.
//   - `specs/weapons.md` ("Hits and death"): "A hit removes the shape's damage
//     per hit from the enemy's `hp`"; a rat has HP `15` and radius `12`
//     (`specs/enemies.md`), so one hit of 12 leaves it at 3 and a second takes
//     it below `0`, which is what tells one pulse from three.
//   - `specs/instrumentation.md` (`setPassive`): "every multiplier follow[s]
//     from the next read", so Mirror is in force on the pulse tick.
//
// WHAT IS READ. After the pulse tick with Mirror 2 held: exactly one aura zone
// with weapon `corona`, and the rat at 15 − 12 = 3, the fixed damage removed
// once. A build that reads the bonus into Corona either stands a zone per
// amount or hits the rat once per amount, and both readings catch it.
//
// WHY THE NIGHT IS POSED AS IT IS. Corona alone with Mirror at level 2 the only
// passive, one rat 40 units along `+x` inside the fixed radius, every driver
// switch off but `weaponFire`: Mirror changes `amountBonus` and nothing else,
// so no other figure of the pulse moves, and nothing else can touch the rat or
// add a zone.
//
// TOLERANCE. `FIGURE_TOLERANCE` on the hp: an exact difference of stated
// figures, read back as a double. None on the count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CORONA_STATS, PASSIVES } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  holdPassive,
  spawnEnemyNear,
  type Harness,
} from "../harness";
import { armEvolved, assertTook } from "./evolved";
import { coronaAuras, PROBE_DX } from "./corona";

/** Mirror at its top level: an `amountBonus` of 2. */
const MIRROR_LEVEL = PASSIVES.mirror.maxLevel;

/** The probe: a rat, HP 15, which one pulse of 12 leaves alive and two do not. */
const PROBE = "rat";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps one aura and removes the fixed damage once with Mirror 2 held", async () => {
  armEvolved(h, "corona");
  const rat = spawnEnemyNear(h, PROBE, PROBE_DX, 0);
  holdPassive(h, "mirror", MIRROR_LEVEL);
  enable(h, "weaponFire");
  const posed = h.snapshot();
  assertEqual(
    posed.run.passives[0]?.level,
    MIRROR_LEVEL,
    "Mirror's posed level",
  );

  const after = await h.tick(1);
  captureStill(h, "one");

  assertEqual(
    coronaAuras(after).length,
    1,
    "aura zones with weapon corona after the pulse tick",
  );
  assertTook(
    posed,
    after,
    rat,
    CORONA_STATS.damage,
    "the rat after the pulse at amount three",
  );
});
