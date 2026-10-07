// director/swarm-gnats-scaled — a swarm's gnats take the night's health
// scaling like any common enemy.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Scripted events"): "Swarm gnats take health scaling
//     like any common enemy and despawn by distance like any common enemy."
//   - `specs/enemies.md` ("Health scaling"): "hpMul(time) = 1 +
//     HP_SCALE_PER_MINUTE * floor(time / 60)" with `HP_SCALE_PER_MINUTE`
//     (`0.15`) and "`time` the run clock, in seconds, on the tick the enemy
//     spawns. A common enemy spawns with `maxHp = hp * hpMul(time)` and `hp =
//     maxHp`".
//   - `specs/enemies.md` ("The roster"): the Gnat's HP is 2, and "The HP column
//     is the base the scaling below multiplies at spawn."
//   - `specs/enemies.md` ("Scripted events"): the 1:00 event is a gnat swarm,
//     firing on tick 3600, where the run clock is 60 seconds and `hpMul` is
//     1.15.
//
// WHAT IS READ. Every gnat of the 1:00 swarm on the tick it lands: `maxHp` must
// be 2 × 1.15 = 2.3, and `hp` must equal it. A build that spawned its swarm
// unscaled reads 2.
//
// WHY THE NIGHT IS POSED AS IT IS. `events` alone is on, so the gnats on the
// field are the swarm's and no weapon, contact, or removal has touched their
// health between the spawn and the reading.
//
// THE PICTURE. What the director spawns lands 760 units out, past the edge of
// the view, so the still is taken after a closing drift that lets it travel in.
// Every reading the assertions use is taken before that drift, and the drift
// cannot fail the item.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9): the product of two stated figures,
// which a build may form in either order.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  ENEMIES,
  EVENTS,
  FIGURE_TOLERANCE,
  hpMul,
  SWARM_SIZE,
} from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";
import { closeIn, crossEvent, enemiesOfType } from "./stage";

/** The 1:00 gnat swarm, which fires where the clock reads 60 seconds. */
const SWARM_TIME = EVENTS[0].time;

/** "maxHp = hp * hpMul(time)": 2 × 1.15. */
const SCALED_HP = ENEMIES.gnat.hp * hpMul(SWARM_TIME);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("scales a swarm gnat's health by the clock it spawned on", async () => {
  isolate(h);
  enable(h, "events");

  const pair = await crossEvent(h, SWARM_TIME);
  const gnats = enemiesOfType(pair.on, "gnat");
  await closeIn(h);
  captureStill(h, "scaled");

  assertLength(gnats, SWARM_SIZE, "the swarm's gnats");
  for (const gnat of gnats) {
    assertWithin(
      gnat.maxHp,
      SCALED_HP,
      FIGURE_TOLERANCE,
      `the maxHp of swarm gnat ${gnat.id}`,
    );
    assertWithin(
      gnat.hp,
      SCALED_HP,
      FIGURE_TOLERANCE,
      `the hp of swarm gnat ${gnat.id}`,
    );
  }
});
