// director/despawn-beyond-distance — a common farther than `DESPAWN_DISTANCE`
// is removed, and removed silently.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("Despawning"): "Each tick
// `despawning` is on, every common enemy whose center is farther than
// `DESPAWN_DISTANCE` (`1200`) units from the lamplighter's center is removed:
// no gem, no kill, no cue, and every re-hit entry naming it dropped." The moth
// is a common ("All ten are rank `common`"), and 1201 is one unit past the
// figure, so the rule applies to it on the first tick it is read.
//
// WHEN IT HAPPENS is fixed by specs/world.md ("One tick", phase 10): the spawn
// director runs on the tick, "despawning while `despawning` is on", so a moth
// posed before a tick is gone at the end of that tick. One tick is therefore
// the whole span.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `despawning` alone.
// `enemyMotion` is off, so the moth is exactly where it was posed when the
// distance is tested and a build whose moth walked in cannot pass by having
// moved inside the boundary. `enemyContact` and `weaponFire` are off, so
// nothing else could remove it, and the kill count is posed to a figure that is
// not `0` so a count that rose is plain. The lamplighter stands at the origin
// and the moth on the `x` axis, so the distance is the figure itself with no
// rounding.
//
// THE TOLERANCE. Presence, counts and drops are read exactly. The silence is
// read as the one-shot cues heard across the tick: the `music` bed loops on
// `playing` by specs/ui.md whatever happens, and this asks about the cue a
// death would raise.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { DESPAWN_DISTANCE, ONE_SHOT_CUES } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  placeEnemy,
  watchNamedCues,
  type Harness,
} from "../harness";

/** One unit past the boundary: "farther than `DESPAWN_DISTANCE`". */
const BEYOND = DESPAWN_DISTANCE + 1;

/** A kill count that is not `0`, so a count that rose is plain. */
const POSED_KILLS = 7;

let h: Harness;

beforeEach(async () => {
  // ARMED, because the reading is a silence: "no cue" only says something
  // about the build once the build's audio could have opened at all.
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("removes a moth 1201 units out on the next tick, with nothing dropped", async () => {
  await isolate(h, { on: ["despawning"] });
  await h.debug.setKills(POSED_KILLS);
  const moth = await placeEnemy(h, "moth", BEYOND, 0);

  const cues = await watchNamedCues(h);
  const after = await h.step(1);
  await captureStill(h, "removed");

  assertEqual(
    enemyById(after, moth.id),
    undefined,
    `the moth ${BEYOND} units from the lamplighter, after one tick`,
  );
  assertLength(after.run.gems, 0, "gems the despawn dropped");
  assertLength(after.run.pickups, 0, "pickups the despawn dropped");
  assertEqual(after.run.kills, POSED_KILLS, "kills across the despawn");
  assertLength(
    cues.filter((cue) => ONE_SHOT_CUES.includes(cue.name as never)),
    0,
    "one-shot cues the despawn played",
  );
});
