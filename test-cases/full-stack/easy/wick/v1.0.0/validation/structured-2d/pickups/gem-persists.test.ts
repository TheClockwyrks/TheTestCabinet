// pickups/gem-persists — a gem never despawns.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("Gems"): "A gem sits where
// it was dropped until it is attracted, and it stays on the field until it is
// collected." `specs/enemies.md` ("Despawning") puts distance removal on
// enemies alone: "every common enemy whose center is farther than
// `DESPAWN_DISTANCE` (`1200`) units from the lamplighter's center is removed".
// So a gem posed `POSED_DISTANCE` (`3000`) units out, two and a half times the
// distance that removes an enemy, is still on the field however long the night
// runs, with `despawning` on.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `despawning` turned
// back on, the one faculty this check is about: with it on, "Commons beyond
// `DESPAWN_DISTANCE` are removed" (`specs/instrumentation.md`), so a build that
// sweeps its gems along with its enemies removes this one. Nothing is alive,
// nothing else is dropped, and no slot is held, so no draft attracts the gem
// and nothing collects it. `POSED_DISTANCE` is far outside `PICKUP_RADIUS`
// (`48`), so the gem is never attracted and never flies. No key is pressed, so
// the lamplighter holds the origin and the distance stays the posed one.
// `HELD_TICKS` (`600`) is ten seconds of game time.
//
// THE TOLERANCE. `MOTION_EPS` (`1e-6`) on the position it held; its presence
// and its `attracted` flag are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertNear } from "../assert";
import { MOTION_EPS, TICK_HZ } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  gemById,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

/** Two and a half times `DESPAWN_DISTANCE` (`1200`), the figure that removes an enemy. */
const POSED_DISTANCE = 3000;

/** Ten seconds of game time. */
const HELD_TICKS = 10 * TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps a gem 3000 units out on the field across 600 ticks with despawning on", async () => {
  isolate(h);
  enable(h, "despawning");
  const opened = h.snapshot();
  assertEqual(opened.despawning, true, "the despawning switch");
  const at = opened.run.player;
  const id = placeGem(h, "small", at.x + POSED_DISTANCE, at.y);
  const posed = gemById(h.snapshot(), id);
  assertDefined(posed, "the gem spawnGem placed");

  const after = await advanceTicks(h, HELD_TICKS);
  captureStill(h, "kept");

  assertEqual(after.run.tick, opened.run.tick + HELD_TICKS, "the ticks run");
  const seen = gemById(after, id);
  assertDefined(
    seen,
    "the gem after the ten seconds (specs/world.md, Gems: it stays on the field until it is collected)",
  );
  assertEqual(seen?.attracted, false, "the kept gem's attracted flag");
  assertNear(
    seen?.x ?? NaN,
    posed?.x ?? NaN,
    MOTION_EPS,
    "the gem's x after the ten seconds, in units",
  );
  assertNear(
    seen?.y ?? NaN,
    posed?.y ?? NaN,
    MOTION_EPS,
    "the gem's y after the ten seconds, in units",
  );
});
