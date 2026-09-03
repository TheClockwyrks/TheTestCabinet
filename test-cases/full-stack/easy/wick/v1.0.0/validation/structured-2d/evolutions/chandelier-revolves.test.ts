// evolutions/chandelier-revolves — Chandelier's lanterns revolve at
// LANTERN_ANGULAR_SPEED, on a circle that stays centered on the lamplighter.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Chandelier"): "From
// the next tick they revolve at `LANTERN_ANGULAR_SPEED` (`180`) degrees per
// second clockwise, the circle they ride centered on the player's center every
// tick". The angle convention is `specs/weapons.md`'s ("The nearest enemy"):
// "positive angles turning toward `+y`, which is clockwise on screen." Thirty
// ticks is `30 / TICK_HZ` = 0.5 seconds (`specs/world.md`, The plane), so the
// turn is `180 × 0.5` = 90 degrees toward `+y` from wherever the lantern
// started. `CHANDELIER_STATS` gives orbit 120, and with no Glass held
// `areaMul` is 1 (`specs/passives.md`), so every lantern sits 120 units from
// the lamplighter's center on every tick — including the ticks after the
// lamplighter has moved.
//
// HOW THE LAMPLIGHTER MOVES, AND WHY THAT WAY. Halfway through the span it is
// moved with `setPlayerPosition`, which "Sets the lamplighter's center to
// `(x, y)`. Nothing else moves ... the aura and lanterns follow on the next
// tick" (`specs/instrumentation.md`), and `specs/state.md` (`ZoneState`) adds
// that "a lamplighter pose moves the lantern with it and changes its angle not
// at all". A pose rather than a held key, because the requirement is about the
// circle following its center and not about the movement controls: a build
// with broken movement must fail the movement points and pass this one. So the
// turn over the whole span is still the full 90 degrees, and by the end of it
// every lantern rides a circle of 120 about the NEW center — where a set left
// on the circle it was created about reads hundreds of units off.
//
// WHY THE FIRST READING IS TAKEN BEFORE `effectMotion` IS ON. The placing tick
// runs with every switch off, so the angle read after it is the angle the set
// STARTED at ("every lantern holds its angle", `specs/instrumentation.md`);
// `effectMotion` is turned on only then, and "turning one back on resumes that
// faculty from the next tick, with no catching up for the ticks it missed", so
// the thirty ticks that follow are thirty ticks of revolving and the reading is
// the RATE alone.
//
// WHICH LANTERN IS FOLLOWED. The one with the lowest id, followed by that id
// across the span; the set never loses a lantern ("its lanterns never vanish"),
// so the same zone is read at both ends.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing but
// Chandelier, the lamplighter posed off the origin so the angles read are
// angles about the LAMPLIGHTER, `weaponFire` left off so nothing refires under
// the reading, and no enemy, spawn or event to touch the set.
//
// THE TOLERANCE. `ANGLE_EPS` on the turn, which the build integrates over
// thirty steps of `180 × TICK_DT` degrees, and `REAL_EPS` on each orbit, a
// length the build lays with one sine and one cosine about a posed center. A
// set revolving counter-clockwise reads −90 and a set at half or double the
// rate misses by 45 degrees.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertNear } from "../assert";
import {
  ANGLE_EPS,
  CHANDELIER_STATS,
  LANTERN_ANGULAR_SPEED,
  REAL_EPS,
  TICK_DT,
} from "../constants";
import {
  advanceTicks,
  angularOffset,
  captureReplay,
  createHarness,
  enable,
  zoneById,
  type Harness,
} from "../harness";
import {
  POSED,
  angleAbout,
  chandelierLanterns,
  orbitOf,
  placeChandelier,
} from "./evolved";

/** How many ticks of revolving the check runs. */
const TICKS = 30;

/** The turn those ticks make: `180 × 30 / 60` = 90 degrees toward `+y`. */
const TURN = LANTERN_ANGULAR_SPEED * TICKS * TICK_DT;

/** Where the lamplighter is moved to, halfway through the span. */
const MOVED = { x: POSED.x + 300, y: POSED.y + 200 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("turns the first lantern 90 degrees toward +y over 30 ticks and keeps the circle on the moved lamplighter", async () => {
  const placed = await placeChandelier(h, POSED);
  assertEqual(
    placed.lanterns.length,
    CHANDELIER_STATS.amount,
    "the Chandelier lanterns standing after the placing tick (specs/evolutions.md, Chandelier)",
  );
  const followed = placed.lanterns.reduce((lowest, lantern) =>
    lantern.id < lowest.id ? lantern : lowest,
  );
  const started = angleAbout(placed.after, followed);

  enable(h, "effectMotion");

  const after = await captureReplay(h, "revolving", async () => {
    await advanceTicks(h, TICKS / 2);
    h.debug.setPlayerPosition(MOVED.x, MOVED.y);
    return advanceTicks(h, TICKS / 2);
  });

  assertNear(
    after.run.player.x,
    MOVED.x,
    REAL_EPS,
    "the lamplighter's x after the pose (specs/instrumentation.md, setPlayerPosition)",
  );
  const turned = zoneById(after, followed.id);
  assertDefined(
    turned,
    `lantern ${followed.id} in zones after ${TICKS} ticks, which never vanishes (specs/evolutions.md, Chandelier)`,
  );
  assertNear(
    angularOffset(started, angleAbout(after, turned ?? followed)),
    TURN,
    ANGLE_EPS,
    `the degrees lantern ${followed.id} turned toward +y over ${TICKS} ticks, from ${started.toFixed(3)} (specs/evolutions.md, Chandelier)`,
  );
  for (const lantern of chandelierLanterns(after)) {
    assertNear(
      orbitOf(after, lantern),
      CHANDELIER_STATS.orbit,
      REAL_EPS,
      `lantern ${lantern.id}'s distance from the lamplighter's center after it moved to (${MOVED.x}, ${MOVED.y}) (specs/evolutions.md, Chandelier)`,
    );
  }
});
