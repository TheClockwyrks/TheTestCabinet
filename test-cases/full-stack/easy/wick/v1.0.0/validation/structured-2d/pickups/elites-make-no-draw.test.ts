// pickups/elites-make-no-draw — an elite kill draws for no pickup.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("The drop roll"): "Each
// common enemy killed by a weapon draws from the game's seeded random generator
// on the tick it dies ... Elites and the Dark make no draw; an elite drops its
// chest, and the Dark drops nothing." `specs/enemies.md` ("Drops") gives the
// `elite` rank "One chest", and no gem. `specs/instrumentation.md` ("A
// deterministic core") makes the draw readable: the game "holds one
// pseudo-random generator, seeded by `reset` and keeping its whole state in
// `rngState`, and every random draw comes from it", among them "the bread and
// draft draws". So a mothwing's death leaves exactly one chest at its center,
// no gem, and `rngState` exactly as the tick found it. A build that draws for
// an elite moves `rngState` on that tick even when neither draw lands, so the
// state is the reading rather than the pickups a rare draw would add.
//
// WHY TWENTY KILLS. One kill that left `rngState` alone would be a build that
// draws but happens to leave a state that reads the same, or a build whose
// generator moves only on some draws. `KILLS` (`20`) deaths at the one seed,
// each read on its own tick, put that past any accident, and each is also read
// for its own chest, so a build that drops a gem or a second pickup for an
// elite fails on the first of them.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `drops` turned back
// on, which is the faculty the point is about — with it off a death draws
// nothing at all and there would be no draw to find absent. `spawning`,
// `events`, and every other driver switch stay off and no weapon is held, so nothing else in the tick
// can draw from the generator ("a spawn's angle and type, an offer draw, a
// puddle's landing point, a strike's target, a swarm's direction, a chest's
// fallback item" are the other draws, and none of them happens here). The kills
// are made the way `pickups/roll` makes its own: a level-1 Oil Splash puddle
// posed on the elite's own center, which "pulses first on the next tick"
// whatever the switches hold and deals that row's `4`, against an `hp` posed to
// `4` with `setEnemyHp`. `spawnPuddle` is a pose, so no landing point is drawn
// for it. Each elite stands at its own point `POST` (`4000`) units or more from
// the lamplighter, far outside the collection distance
// `PICKUP_ITEM_RADIUS + PLAYER_RADIUS` (`28`), so its chest is not collected and
// no overlay opens to end the run of kills; the field is cleared of pickups
// between kills, so each kill's leavings are read alone.
//
// THE TOLERANCE. None on `rngState`, which is read for equality, nor on the
// counts. `MOTION_EPS` (`1e-6`) on where the chest landed against the center it
// was dropped at.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNear } from "../assert";
import { DEFAULT_SEED, MOTION_EPS, OIL_SPLASH_LEVELS } from "../constants";
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

/** How many elite deaths are read, all in the one seeded run. */
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

it("leaves each of twenty mothwing kills exactly its chest, and rngState untouched", async () => {
  const at = isolate(h, { seed: DEFAULT_SEED }).run.player;
  enable(h, "drops");

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
      `the pickups death ${kill + 1} left (specs/world.md, The drop roll: elites make no draw)`,
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
      after.rngState,
      before.rngState,
      `rngState after the tick of death ${kill + 1}, against what it read before it (specs/world.md, The drop roll)`,
    );

    h.debug.clearPickups();
    h.debug.clearZones();
  }

  captureStill(h, "chest");
});
