// Wick — audio/cue-kill: the tick on which a moth dies plays `kill`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): "`kill` | `CUES.kill` | An enemy dies. At most once
//     per tick", and "Each is played on the tick its event happens".
//   - specs/world.md (One tick, phase 6): "Then an enemy whose `hp` is at or
//     below `0` dies".
//   - specs/instrumentation.md (`spawnProjectile`): a posed projectile takes
//     "the ones the weapon would give a projectile fired on this tick", and
//     first hits on the next tick. Ember's row 1 deals `10` and a moth has `5`
//     HP (specs/weapons.md, specs/enemies.md), so the bolt kills it.
//   - specs/instrumentation.md: a pose "sounds nothing".
//
// WHAT IS READ. Exactly one `kill` play across the one tick the moth dies on,
// with `kills` risen from `0` to `1` as the evidence that a death happened.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night holding one moth and one
// posed bolt, no weapon held and every driver switch off, so no other enemy
// can die on the tick and nothing else on the field raises a cue. The bolt is
// posed onto the moth's center rather than fired, so the tick under test is
// the death and nothing else.
//
// TOLERANCE. None. Both readings are counts.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
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

it("plays kill once on the tick the moth dies", async () => {
  isolate(h);
  spawnEnemyAt(h, "moth", MOTH_X, MOTH_Y);
  spawnProjectileAt(h, "ember", MOTH_X, MOTH_Y, 0, 0, PIERCE);
  const cues = onCue(h);

  const after = await captureReplay(h, "kill", () => h.tick(1));

  assertEqual(after.run.kills, 1, "kills after the moth died");
  assertPlayed(cues, "kill", 1, "kill cues on the tick the moth died");
});
