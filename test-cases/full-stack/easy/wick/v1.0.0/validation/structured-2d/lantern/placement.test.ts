// lantern/placement — a set's lanterns start evenly spaced on the orbit.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Lantern"): "On firing,
// `amount` lanterns appear on a circle of radius `orbit` around the player's
// center, evenly spaced: lantern `i`, counted from `0`, starts at angle
// `i × 360 / amount`." The angle convention is the same file's ("The nearest
// enemy"): "Angles are in degrees, with `0` along `+x` and positive angles
// turning toward `+y`, which is clockwise on screen." Row 2 of the level
// table gives amount 2 and orbit 90, so the two lanterns start at 0 and
// 180 degrees, 90 units from the lamplighter's center: one at
// `(player.x + 90, player.y)` and one at `(player.x − 90, player.y)`.
//
// WHY LEVEL 2. Amount 1 places a lantern at 0 degrees whatever spacing rule a
// build used, so it decides nothing about even spacing; amount 2 is the
// smallest row that does, and it is the row the review item names.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy and no
// passive, so `amountBonus` is 0 and the set is the row's two
// (`specs/passives.md`), the lamplighter posed off the origin so a circle laid
// about anything else reads different angles, Lantern held at level 2 with its
// timer at 0, and `weaponFire` the one switch on. `effectMotion` is off and
// the reading is taken on the firing tick itself, on which the lanterns have
// not yet turned ("From the next tick they revolve"), so what is graded is
// where the set STARTS. Which angle each id took is left open: the two
// starting angles are matched as a set, in ascending angle, since the spec
// fixes the angles a set occupies rather than which id sits at which.
//
// THE TOLERANCE. `MOTION_EPS` in degrees (`ANGLE_EPS`) on each angle and
// `REAL_EPS` on each orbit, both figures the build reaches through one sine
// and one cosine. The two starting angles are 180 degrees apart, so any
// spacing rule other than the stated one — both at 0, or 90 apart — misses by
// tens of degrees.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ANGLE_EPS, LANTERN_LEVELS, REAL_EPS } from "../constants";
import {
  angularOffset,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";
import { POSED, angleAbout, fireLantern, orbitOf } from "./set";

/** The row the review item names: amount 2, orbit 90. */
const LEVEL = 2;
const ROW = LANTERN_LEVELS[LEVEL - 1];

/** The angles the set occupies: `i × 360 / amount` for `i` from 0. */
const ANGLES: readonly number[] = Array.from(
  { length: ROW.amount },
  (_, i) => (i * 360) / ROW.amount,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("puts a level-2 set's two lanterns 90 units from the lamplighter at 0 and 180 degrees", async () => {
  const firing = await fireLantern(h, LEVEL, POSED);
  captureStill(h, "placed");

  assertEqual(
    firing.lanterns.length,
    ROW.amount,
    `the lanterns the firing tick created at level ${LEVEL} (specs/weapons.md, Lantern)`,
  );

  const placed = firing.lanterns.map((lantern) => ({
    id: lantern.id,
    angle: angleAbout(firing.after, lantern),
    orbit: orbitOf(firing.after, lantern),
  }));

  for (const lantern of placed) {
    assertNear(
      lantern.orbit,
      ROW.orbit,
      REAL_EPS,
      `lantern ${lantern.id}'s distance from the lamplighter's center (specs/weapons.md, Lantern)`,
    );
  }

  // Each stated starting angle is claimed by exactly one lantern of the set,
  // matched wrap-aware so a build whose 0 lands a hair under 360 is read as 0.
  for (const angle of ANGLES) {
    const matching = placed.filter(
      (lantern) => Math.abs(angularOffset(angle, lantern.angle)) <= ANGLE_EPS,
    );
    assertEqual(
      matching.length,
      1,
      `the lanterns standing at ${angle} degrees from the lamplighter's center, among ${placed
        .map((lantern) => lantern.angle.toFixed(3))
        .join(", ")} (specs/weapons.md, Lantern)`,
    );
  }
});
