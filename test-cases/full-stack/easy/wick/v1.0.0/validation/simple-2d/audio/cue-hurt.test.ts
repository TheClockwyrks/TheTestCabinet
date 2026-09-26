// Wick — audio/cue-hurt: the tick on which a moth's contact hit lands plays
// `hurt`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): "`hurt` | `CUES.hurt` | The lamplighter takes
//     damage. At most once per tick", and "Each is played on the tick its
//     event happens".
//   - specs/world.md (Contact damage): "the enemy's circle overlaps the
//     lamplighter's when the distance between their centers is less than the
//     enemy's radius plus `PLAYER_RADIUS`. An overlapping enemy whose
//     `contactCooldown` is due lands a hit: `hp` falls by
//     `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`".
//   - specs/instrumentation.md (`spawnEnemy`): a spawned enemy's "`age` and
//     `contactCooldown` are `0`", and a timer at `0` "is due on every tick on
//     which it is `0` after its count-down" (specs/world.md, Timers), so the
//     hit lands on the first tick.
//   - specs/instrumentation.md (`setEnemyContact`): while the switch is on,
//     "An overlapping enemy whose cooldown is due hits".
//
// WHAT IS READ. Exactly one `hurt` play across the one tick the hit lands on,
// with the lamplighter's `hp` fallen as the evidence that damage was taken.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with one moth and nothing
// else, no weapon held, and every switch off but `enemyContact`, the one
// faculty this requirement is about: nothing fires, nothing moves, no gem or
// pickup exists, and the director is held. The moth is posed `MOTH_DX` (5)
// units from the lamplighter's center, inside the moth's radius of `10` plus
// `PLAYER_RADIUS` (12), so the overlap holds on the tick. With `hp` at
// `BASE_MAX_HP` (100) and a moth dealing `5`, the hit cannot end the run and
// bring the `fallen` cue into the reading.
//
// TOLERANCE. `MOTION_TOLERANCE` (1e-6) on the health difference, which is one
// stated figure subtracted from another; none on the count.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan, assertWithin } from "../assert";
import { ENEMIES, MOTION_TOLERANCE } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  onCue,
  spawnEnemyNear,
  type Harness,
} from "../harness";
import { assertPlayed } from "./cues";

/** How far the moth stands from the lamplighter's center: well inside 10 + 12. */
const MOTH_DX = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays hurt once on the tick the moth's contact hit lands", async () => {
  const posed = isolate(h);
  spawnEnemyNear(h, "moth", MOTH_DX, 0);
  enable(h, "enemyContact");
  const cues = onCue(h);

  const after = await captureReplay(h, "hurt", () => h.tick(1));

  assertLessThan(
    after.run.player.hp,
    posed.run.player.hp,
    "the lamplighter's hp after the contact hit",
  );
  assertWithin(
    after.run.player.hp,
    posed.run.player.hp - ENEMIES.moth.damage,
    MOTION_TOLERANCE,
    "the health the moth's hit removed",
  );
  assertPlayed(cues, "hurt", 1, "hurt cues on the tick the hit landed");
});
