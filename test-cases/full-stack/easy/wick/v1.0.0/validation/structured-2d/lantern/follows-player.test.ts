// lantern/follows-player — the orbit stays centered on the lamplighter on
// every tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Lantern"): "the circle
// they ride is centered on the player's center every tick." `specs/world.md`
// ("One tick") orders the phases: the lamplighter moves in phase 2 and "each
// lantern's center [is] placed about the lamplighter's position of this tick"
// in phase 5, so on every tick of a walk each lantern stands exactly `orbit`
// from the lamplighter's center as that tick left it. Row 2 gives orbit 90.
// `specs/instrumentation.md` ("The driver switches") makes the placement
// unconditional: "Placement is gated by neither `weaponFire` nor
// `effectMotion`: on every `playing` tick, whatever the two hold ... each
// lantern's center [is] placed about the lamplighter's position of this tick."
//
// WHY THE LAMPLIGHTER IS WALKED 90 UNITS. `specs/world.md` ("Movement") moves
// it `moveSpeed × TICK_DT` a tick, and `moveSpeed` is `MOVE_SPEED` (`180`)
// with no Bellows held (`specs/passives.md`), so 3 units a tick and 90 over
// 30 ticks — a displacement equal to the orbit itself, so a build that laid
// its circle about the position the set was FIRED at reads distances from 0 to
// 180 rather than a steady 90. The walk is driven by a held `ArrowRight` at
// the engine's own event target, which is how a player moves
// (`specs/controls.md`), and it is sampled a tick at a time so the reading is
// per tick rather than at the end of the span.
//
// WHY LEVEL 2 AND `effectMotion` ON. Row 2 is two lanterns, so "every lantern"
// is more than one, and `effectMotion` is on as the review item states, so the
// set is revolving while it follows: the distance from the lamplighter is the
// one thing that must hold while both the center and the angle move.
// `weaponFire` is off after the firing, so no second set arrives; the next
// firing would be 360 ticks out in any case. How MANY lanterns row 2 gives is
// the row check's point, so the count each tick is read against the count the
// firing created rather than against the row.
//
// THE TOLERANCE. `MOTION_EPS` on each tick's distance. The lamplighter's
// position is integrated over up to 30 steps and each lantern's center is one
// sine and one cosine off it, so the distance is exact to a few ulps; the
// bound is a millionth of a unit, far under the tenths the specification
// distinguishes and far under any lag of even one tick, which would read 3
// units off.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNear } from "../assert";
import { LANTERN_LEVELS, MOTION_EPS, MOVE_SPEED, TICK_DT } from "../constants";
import {
  captureReplay,
  createHarness,
  disable,
  enable,
  holdSampling,
  type Harness,
} from "../harness";
import { fireLantern, lanternsOf, orbitOf } from "./set";

/** Row 2: two lanterns on an orbit of 90, duration 3.0 (180 ticks). */
const LEVEL = 2;
const ROW = LANTERN_LEVELS[LEVEL - 1];

/** Ticks of the held walk; 90 units at 3 a tick, and inside the set's life. */
const TICKS = 30;

/** How far the walk carries the lamplighter: `180 × 30 / 60`. */
const WALKED = MOVE_SPEED * TICKS * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps every lantern 90 units from the lamplighter on each of 30 ticks of a walk right", async () => {
  const firing = await fireLantern(h, LEVEL);
  assertGreaterThan(
    firing.lanterns.length,
    0,
    `the lanterns the firing tick created at level ${LEVEL} (specs/weapons.md, Lantern)`,
  );
  /** The set the firing made, whose every member the walk must keep on the orbit. */
  const SET = firing.lanterns.length;

  disable(h, "weaponFire");
  enable(h, "effectMotion");

  const walk = await captureReplay(h, "following", () =>
    holdSampling(h, ["ArrowRight"], TICKS),
  );

  assertEqual(
    walk.length,
    TICKS,
    "the ticks the held walk sampled, one snapshot each",
  );
  assertNear(
    walk[TICKS - 1].run.player.x - firing.after.run.player.x,
    WALKED,
    MOTION_EPS,
    `the units the lamplighter walked right over ${TICKS} ticks (specs/world.md, Movement)`,
  );

  walk.forEach((s, i) => {
    const lanterns = lanternsOf(s);
    assertEqual(
      lanterns.length,
      SET,
      `the lanterns in zones on tick ${i + 1} of the walk, of the ${SET} the firing created`,
    );
    for (const lantern of lanterns) {
      assertNear(
        orbitOf(s, lantern),
        ROW.orbit,
        MOTION_EPS,
        `lantern ${lantern.id}'s distance from the lamplighter's center on tick ${i + 1} of the walk (specs/weapons.md, Lantern)`,
      );
    }
  });
});
