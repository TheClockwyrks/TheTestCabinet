// pickups/elites-make-no-draw — an elite kill makes no drop roll.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("The drop roll"): "each
// common enemy killed by a weapon rolls for a pickup on the tick it dies ...
// Elites and the Dark make no roll; an elite drops its chest, and the Dark
// drops nothing." `specs/enemies.md` ("Drops") gives the `elite` rank "One
// chest", and no gem. `specs/instrumentation.md` ("Drawn outcomes",
// `setNextDrop`) makes the roll readable: "The next common enemy killed by a
// weapon while `drops` is on drops that pickup ... and that kill consumes it.
// A death while `drops` is off, an elite's death, and the Dark's death leave
// it standing." So a mothwing's death under a posed `bread` leaves exactly one
// chest at its center, no gem, no bread, and `nextDrop` still posed. A build
// that rolls for an elite either drops the posed bread beside the chest or
// consumes the pose, and either is read on the tick.
//
// WHY TWENTY KILLS. Each of `KILLS` (`20`) deaths is read on its own tick for
// its own chest and for the pose still standing, so a build that drops a gem
// or a second pickup for an elite, or spends the pose on one, fails on the
// first of them.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `drops` turned back
// on, which is the faculty the point is about — with it off a death makes no
// roll at all and there would be no roll to find absent. `spawning`, `events`,
// and every other driver switch stay off and no weapon is held, so nothing
// else in the tick kills. The kills are made the way `pickups/roll` makes its
// own: a level-1 Oil Splash puddle posed on the elite's own center, which
// "pulses first on the next tick" whatever the switches hold and deals that
// row's `4`, against an `hp` posed to `4` with `setEnemyHp`. Each elite stands
// at its own point `POST` (`4000`) units or more from the lamplighter, far
// outside the collection distance `PICKUP_ITEM_RADIUS + PLAYER_RADIUS` (`28`),
// so its chest is not collected and no overlay opens to end the run of kills;
// the field is cleared of pickups between kills, so each kill's leavings are
// read alone.
//
// THE TOLERANCE. None on the counts, the kind, and the posed value.
// `MOTION_EPS` (`1e-6`) on where the chest landed against the center it was
// dropped at.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNear } from "../assert";
import { MOTION_EPS, OIL_SPLASH_LEVELS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  enemyById,
  isolate,
  placeEnemy,
  placePuddle,
  type Harness,
} from "../harness";

/** A level-1 Oil Splash puddle's damage, `4`, with no Wick held. */
const PULSE_DAMAGE = OIL_SPLASH_LEVELS[0].damage;

/** How many elite deaths are read, all in the one run. */
const KILLS = 20;

/** How far the nearest elite stands from the lamplighter, in units. */
const POST = 4000;

/** How far apart the posts stand, so each kill has its own point. */
const SPACING = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves each of twenty mothwing kills exactly its chest, and the posed drop standing", async () => {
  const at = isolate(h).run.player;
  enable(h, "drops");
  h.debug.setNextDrop("bread");

  for (let kill = 0; kill < KILLS; kill += 1) {
    const x = at.x + POST + kill * SPACING;
    const id = placeEnemy(h, "mothwing", x, at.y);
    h.debug.setEnemyHp(id, PULSE_DAMAGE);
    placePuddle(h, "oil-splash", x, at.y);

    const before = h.snapshot();
    const after = await advanceTicks(h, 1);

    assertEqual(
      enemyById(after, id),
      undefined,
      `mothwing ${id} after the ${PULSE_DAMAGE}-damage pulse that took it to 0 hp (specs/weapons.md, Hits and death)`,
    );
    assertEqual(
      after.run.kills,
      before.run.kills + 1,
      `the kills after death ${kill + 1}`,
    );
    assertLength(
      after.run.gems,
      0,
      `the gems death ${kill + 1} left, an elite's drop being one chest alone (specs/enemies.md, Drops)`,
    );
    assertLength(
      after.run.pickups,
      1,
      `the pickups death ${kill + 1} left (specs/world.md, The drop roll: elites make no roll)`,
    );
    const chest = after.run.pickups[0];
    assertEqual(chest.kind, "chest", `the kind death ${kill + 1} left`);
    assertNear(
      chest.x,
      x,
      MOTION_EPS,
      `the chest's x against the center death ${kill + 1} happened at, in units`,
    );
    assertNear(
      chest.y,
      at.y,
      MOTION_EPS,
      `the chest's y against the center death ${kill + 1} happened at, in units`,
    );
    assertEqual(
      after.run.nextDrop,
      "bread",
      `nextDrop after the tick of death ${kill + 1}, which an elite's death leaves standing (specs/instrumentation.md, setNextDrop)`,
    );

    h.debug.clearPickups();
    h.debug.clearZones();
  }

  captureStill(h, "chest");
});
