// Wick — audio/cue-hit: the tick on which a bolt damages a moth plays `hit`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): the cue table's first row, "`hit` | `CUES.hit` | An
//     enemy takes damage. At most once per tick", and "Each is played on the
//     tick its event happens".
//   - specs/world.md (One tick, phase 6): "every projectile and zone hits,
//     this tick's new ones included ... Then an enemy whose `hp` is at or
//     below `0` dies".
//   - specs/instrumentation.md (`spawnProjectile`): a posed projectile's
//     "`damage` is that row's damage times the `damageMul` in force at the
//     call"; and a pose "first moves, first hits, and first pulses on the next
//     tick". Ember's row 1 damage is `10` (specs/weapons.md).
//   - specs/instrumentation.md: a pose "sounds nothing", so every cue
//     recorded below belongs to the one tick the point runs.
//
// WHAT IS READ. Exactly one `hit` play across the one tick on which the bolt
// reaches the moth, with the moth gone from the field as the evidence that the
// bolt's damage landed at all.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with no enemy but the
// moth, no weapon held, and every driver switch off, so nothing else on the
// field can raise a cue: no weapon fires, no enemy moves or touches the
// lamplighter, no gem or pickup exists, and the director is held. The bolt is
// posed onto the moth's own center rather than fired, so the tick under test
// is the hit and nothing else; `effectMotion` stays off, under which
// "`ttl` and every re-hit entry still count, and hits still resolve"
// (specs/instrumentation.md), so the bolt hits where it was posed.
//
// TOLERANCE. None. Both readings are counts.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  enemyById,
  isolate,
  onCue,
  spawnEnemyAt,
  spawnProjectileAt,
  type Harness,
} from "../harness";
import { assertPlayed } from "./cues";

/** Where the moth stands, clear of the lamplighter's circle at the origin. */
const MOTH_X = 300;
const MOTH_Y = 0;

/** A bolt of pierce `0`: Ember's row-1 pierce (specs/weapons.md). */
const PIERCE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays hit once on the tick the bolt reaches the moth", async () => {
  isolate(h);
  const moth = spawnEnemyAt(h, "moth", MOTH_X, MOTH_Y);
  spawnProjectileAt(h, "ember", MOTH_X, MOTH_Y, 0, 0, PIERCE);
  const cues = onCue(h);

  const after = await captureReplay(h, "hit", () => h.tick(1));

  assertEqual(
    enemyById(after, moth),
    undefined,
    "the moth after the bolt's damage landed",
  );
  assertPlayed(cues, "hit", 1, "hit cues on the tick the bolt landed");
});
