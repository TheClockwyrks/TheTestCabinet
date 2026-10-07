// lantern/set-fixed-on-mirror — a Mirror level gained mid-set leaves the live
// set's count alone.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Lantern"): "A set is
// fixed when it is created: a Mirror level gained while a set lives leaves
// that set's count as it is, and the next firing reads the new amount." Row 1
// of the level table gives amount 1, and Mirror is "`+1` amount"
// (`specs/passives.md`, whose `amountBonus` is `MIRROR_AMOUNT_PER_LEVEL ×
// mirror`), so a build that recomputed a live set's amount would stand two
// lanterns where the spec keeps one. `specs/instrumentation.md`
// (`setPassive`): "Puts passive `id`, a `PassiveId`, at `level` in `slot` ...
// every multiplier follow[s] from the next read", so the level is genuinely
// held from the call onward and the amount the set would read has changed.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing but
// Lantern at level 1. The set is fired first, Mirror 1 is placed while it is
// alive, and 30 further ticks run — well inside the set's 3.0-second life,
// `round(3.0 × 60)` = 180 ticks (`specs/world.md`, Timers) — so every tick of
// the reading falls inside the same set. `weaponFire` is turned off after the
// firing so the second firing, due 360 ticks out in any case, cannot be
// mistaken for a change to the live set, and the lantern is followed by its
// own id: what is graded is that the set still holds exactly the one lantern
// the firing created, neither joined by another nor replaced by a fresh pair.
// `effectMotion` stays off, so nothing turns and the still shows the set as
// it was created.
//
// THE TOLERANCE. None: the requirement is a count of zones and the identity of
// the one in them.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertLength } from "../assert";
import { LANTERN_LEVELS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  disable,
  holdPassive,
  type Harness,
} from "../harness";
import { fireLantern, lanternsOf } from "./set";

/** Row 1 of Lantern: one lantern, duration 3.0 (180 ticks). */
const LEVEL = 1;
const ROW = LANTERN_LEVELS[LEVEL - 1];

/** The Mirror level gained mid-set, worth `+1` amount to the NEXT firing. */
const MIRROR = 1;

/** Ticks run after Mirror is gained, well inside the set's 180-tick life. */
const TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves a live level-1 set at its one lantern after Mirror 1 is gained", async () => {
  const firing = await fireLantern(h, LEVEL);
  assertEqual(
    firing.lanterns.length,
    ROW.amount,
    `the lanterns the firing created at level ${LEVEL} (specs/weapons.md, Lantern)`,
  );
  const lantern = firing.lanterns[0];
  assertDefined(lantern, "a lantern the firing tick created");

  disable(h, "weaponFire");
  holdPassive(h, "mirror", MIRROR);
  assertEqual(
    h.snapshot().run.passives.find((passive) => passive.id === "mirror")?.level,
    MIRROR,
    "the Mirror level held while the set lives (specs/instrumentation.md, setPassive)",
  );

  const after = await advanceTicks(h, TICKS);
  captureStill(h, "fixed");

  const standing = lanternsOf(after);
  assertLength(
    standing,
    ROW.amount,
    `the lanterns standing ${TICKS} ticks after Mirror ${MIRROR} was gained mid-set (specs/weapons.md, Lantern)`,
  );
  assertEqual(
    standing[0]?.id,
    lantern.id,
    "the id of the lantern still standing, which is the one the firing created",
  );
});
