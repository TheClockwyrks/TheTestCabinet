// Wick — enemies/chase-holds-at-center: a chaser standing on the lamplighter's
// center keeps the heading it had and stays where it is.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Chase"): "A chaser whose
// center coincides with the lamplighter's keeps its heading and stays where it
// is that tick; its age still counts." The unit vector the behavior would
// otherwise compute is undefined at a distance of zero, and this is the rule
// that says what happens instead: the heading is the one the enemy already
// carried, and the position does not move.
//
// THE POSE. An isolated night holding nothing but the lamplighter and one moth,
// `enemyMotion` alone turned on. The moth is spawned 200 units along `+x`,
// where "its heading ... the unit vector from its spawn point to the
// lamplighter's center" ("The life of an enemy") is `(-1, 0)`, and is then
// moved onto the lamplighter's center with `setEnemyPosition`, which leaves
// "its heading, age, and health ... untouched" (`specs/instrumentation.md`).
// So the heading standing at the coincidence is `(-1, 0)`, which is neither of
// the two answers a build that recomputed anyway would reach: the unit vector
// is undefined, and the fallback the spawn rule uses, "the facing direction of
// `specs/weapons.md`", is `(+1, 0)` for a lamplighter that "starts ... facing
// `right`" (`specs/world.md`). Then one tick.
//
// `enemyContact` is held, so the moth standing on the lamplighter takes no
// health and nothing ends the run underneath the reading.
//
// TOLERANCE. `FLOAT_TOL` on the heading, which is exactly the posed unit
// vector; `POSITION_TOL` on the position, which is exactly the lamplighter's
// center. The wrong answers, a heading flipped to the facing direction and a
// step of `100 / 60` in any direction, are whole units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { FLOAT_TOL, POSITION_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  player,
  type Harness,
} from "../harness";
import { headingOf } from "./stage";

/** How far along `+x` the moth spawns, so its heading is `(-1, 0)`. */
const SPAWN_GAP = 200;

/** The heading the spawn gives it, and the one the coincidence must keep. */
const HELD_HEADING = { x: -1, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a moth's heading and place across a tick spent on the lamplighter's center", async () => {
  const posed = await isolate(h, { on: ["enemyMotion"] });
  const at = player(posed);
  const moth = await placeEnemy(h, "moth", at.x + SPAWN_GAP, at.y);
  await h.debug.setEnemyPosition(moth.id, at.x, at.y);

  const after = await h.step(1);
  await captureStill(h, "center");

  const held = mustEnemy(after, moth.id);
  assertNear(
    headingOf(held).x,
    HELD_HEADING.x,
    FLOAT_TOL,
    "the coincident moth's heading x after the tick",
  );
  assertNear(
    headingOf(held).y,
    HELD_HEADING.y,
    FLOAT_TOL,
    "the coincident moth's heading y after the tick",
  );
  assertNear(
    held.x,
    player(after).x,
    POSITION_TOL,
    "the coincident moth's x after the tick: the lamplighter's own",
  );
  assertNear(
    held.y,
    player(after).y,
    POSITION_TOL,
    "the coincident moth's y after the tick: the lamplighter's own",
  );
});
