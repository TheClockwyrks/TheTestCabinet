// Wick — enemies/weave-holds-at-center: a weaver whose anchor sits on the
// lamplighter's center keeps its heading and stays where it is.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Weave"): "A weaver whose
// anchor coincides with the lamplighter's center keeps its heading and stays
// where it is that tick; its age still counts, so on the next tick its anchor
// is recovered from the new age as on any tick." The unit vector the tick would
// otherwise compute, "`heading = unit(lamplighter - anchor)`", is undefined at
// a distance of zero, and this is the rule that says what happens instead: the
// heading is the one the enemy already carried, and the position — "The state
// carries the position and the heading" — does not move. The trailing clause is
// what fixes that reading: the age advancing while the position stands still is
// exactly why the anchor the NEXT tick recovers is a different point, which is
// nothing to say if the tick had held the anchor and redrawn the position.
//
// THE POSE. An isolated night holding nothing but the lamplighter at the origin
// and one wisp, `enemyMotion` alone turned on. The wisp is spawned 300 units
// along `+x`, where its heading is `(-1, 0)` and, at `age` `0` with `offset(0)`
// `0` (`offset(age) = WISP_AMPLITUDE * sin(2 * PI * age / WISP_PERIOD)`), its
// anchor is its spawn point; `setEnemyPosition` then puts it on the
// lamplighter's center, which leaves "its heading, age, and health ...
// untouched" (`specs/instrumentation.md`) and, the offset still being `0`, puts
// its anchor there too. So the coincidence the rule turns on is established, and
// the heading standing at it is `(-1, 0)` — neither answer a build that
// recomputed anyway could reach, since the unit vector is undefined and the
// spawn rule's fallback, "the facing direction", is `(+1, 0)` for a lamplighter
// that "starts ... facing `right`" (`specs/world.md`). Then one tick.
//
// `enemyContact` is held, so the wisp standing on the lamplighter takes no
// health and nothing ends the run underneath the reading.
//
// TOLERANCE. `FLOAT_TOL` on the heading, exactly the posed unit vector;
// `POSITION_TOL` on the position against the lamplighter's center. The wrong
// answers — a heading flipped to the facing direction, a step of `90 / 60` in
// any direction, and the `4.18` the offset at one tick of age would throw the
// position by — are units away.

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

/** How far along `+x` the wisp spawns, so its heading is `(-1, 0)`. */
const SPAWN_GAP = 300;

/** The heading the spawn gives it, and the one the coincidence must keep. */
const HELD_HEADING = { x: -1, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a wisp's heading and place across a tick whose anchor is the lamplighter's center", async () => {
  const posed = await isolate(h, { on: ["enemyMotion"] });
  const at = player(posed);
  const wisp = await placeEnemy(h, "wisp", at.x + SPAWN_GAP, at.y);
  await h.debug.setEnemyPosition(wisp.id, at.x, at.y);

  const after = await h.step(1);
  await captureStill(h, "center");

  const held = mustEnemy(after, wisp.id);
  assertNear(
    headingOf(held).x,
    HELD_HEADING.x,
    FLOAT_TOL,
    "the coincident wisp's heading x after the tick",
  );
  assertNear(
    headingOf(held).y,
    HELD_HEADING.y,
    FLOAT_TOL,
    "the coincident wisp's heading y after the tick",
  );
  assertNear(
    held.x,
    player(after).x,
    POSITION_TOL,
    "the coincident wisp's x after the tick: the lamplighter's own",
  );
  assertNear(
    held.y,
    player(after).y,
    POSITION_TOL,
    "the coincident wisp's y after the tick: the lamplighter's own",
  );
});
