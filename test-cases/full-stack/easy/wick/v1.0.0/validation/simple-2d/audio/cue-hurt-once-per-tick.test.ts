// Wick — audio/cue-hurt-once-per-tick: a tick on which three overlapping moths
// each land a hit plays `hurt` exactly once.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): "`hurt` | The lamplighter takes damage. At most
//     once per tick", and "at most once on that tick".
//   - specs/world.md (Contact damage): "several overlapping enemies each hit
//     on their own schedule", each hit taking `max(MIN_DAMAGE_TAKEN, enemy
//     damage - armor)` from `hp`; a moth deals `5` (specs/enemies.md) and
//     `armor` "is `0` with no Brass held".
//   - specs/instrumentation.md (`spawnEnemy`): a spawned enemy's
//     `contactCooldown` is `0`, and a timer at `0` is due (specs/world.md,
//     Timers), so all three hit on the first tick.
//
// WHAT IS READ. Exactly one `hurt` play across the one tick, with `hp` fallen
// by three moths' damage as the evidence that three separate hits landed on
// that tick rather than one.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night holding the three moths
// and nothing else, no weapon held, and every switch off but `enemyContact`.
// Each moth is posed `MOTH_OFFSET` (5) units from the lamplighter's center on
// its own side, inside the moth's radius of `10` plus `PLAYER_RADIUS` (12), so
// every one of them overlaps on the tick. `hp` starts at `BASE_MAX_HP` (100)
// and the three hits remove `15` together, far from the ending that would
// bring the `fallen` cue into the reading.
//
// TOLERANCE. `MOTION_TOLERANCE` (1e-6) on the health difference, three stated
// figures subtracted from another; none on the count.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin } from "../assert";
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

/** How many moths stand on the lamplighter: the count the review item names. */
const MOTHS = 3;

/** How far each moth stands from the center: well inside 10 + 12. */
const MOTH_OFFSET = 5;

/** Where the three moths stand, each on its own side of the lamplighter. */
const PLACES: readonly (readonly [number, number])[] = [
  [MOTH_OFFSET, 0],
  [-MOTH_OFFSET, 0],
  [0, MOTH_OFFSET],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays hurt once for three hits landed on one tick", async () => {
  const posed = isolate(h);
  for (const [dx, dy] of PLACES) spawnEnemyNear(h, "moth", dx, dy);
  enable(h, "enemyContact");
  const cues = onCue(h);

  const after = await captureReplay(h, "once", () => h.tick(1));

  assertWithin(
    after.run.player.hp,
    posed.run.player.hp - MOTHS * ENEMIES.moth.damage,
    MOTION_TOLERANCE,
    "the health three moths' hits removed",
  );
  assertPlayed(cues, "hurt", 1, "hurt cues on the tick three hits landed");
});
