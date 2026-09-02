// Wick — instrumentation/switch-enemy-motion: with `setEnemyMotion(false)`, a
// moth and a wisp hold their positions and headings across 60 ticks while
// their age and contact cooldown still count; with the switch back on they
// move from the next tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// switch table, `enemyMotion` off: "Every enemy holds its position and
// heading. `age` and `contactCooldown` still count." `specs/world.md`, "One
// tick", phase 4: "Every enemy ages by `TICK_DT`, and, while `enemyMotion` is
// on, moves"; phase 7: "Every live enemy's `contactCooldown` counts down".
// "Timers": 0.5 s counts to exactly 0 within 30 ticks and holds there.
//
// THE DRIVE. An isolated run, a moth at (200, 0) and a wisp at (0, -300), each
// with a contact cooldown of 0.5 s posed, and 60 ticks with the switch off:
// positions and headings exact, `age` 1.0 (`MOTION_EPS`, sixty steps),
// `contactCooldown` exactly 0. Then the switch on and one tick: both are
// somewhere other than where they held.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNear,
  assertNotDeepEqual,
} from "../assert";
import { MOTION_EPS, TICK_DT } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enable,
  enemyById,
  isolate,
  placeEnemy,
  type Harness,
  type SnapshotEnemy,
  type WickSnapshot,
} from "../harness";

const HELD_TICKS = 60;
const POSED_COOLDOWN = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

function found(s: WickSnapshot, id: number, what: string): SnapshotEnemy {
  const enemy = enemyById(s, id);
  if (enemy === undefined)
    throw new Error(`Expected: ${what} alive\nActual: gone`);
  return enemy;
}

function place(enemy: SnapshotEnemy): { x: number; y: number } {
  return { x: enemy.x, y: enemy.y };
}

it("holds every enemy still while off and lets them move once on", async () => {
  isolate(h);
  const moth = placeEnemy(h, "moth", 200, 0);
  const wisp = placeEnemy(h, "wisp", 0, -300);
  h.debug.setEnemyContactCooldown(moth, POSED_COOLDOWN);
  h.debug.setEnemyContactCooldown(wisp, POSED_COOLDOWN);
  const before = h.snapshot();

  const { held, moved } = await captureReplay(h, "held", async () => {
    const held = await advanceTicks(h, HELD_TICKS);
    enable(h, "enemyMotion");
    const moved = await advanceTicks(h, 1);
    return { held, moved };
  });

  for (const [id, name] of [
    [moth, "the moth"],
    [wisp, "the wisp"],
  ] as const) {
    const start = found(before, id, name);
    const stayed = found(held, id, name);
    assertDeepEqual(
      place(stayed),
      place(start),
      `${name}'s position after ${HELD_TICKS} held ticks`,
    );
    assertDeepEqual(
      stayed.heading,
      start.heading,
      `${name}'s heading after ${HELD_TICKS} held ticks`,
    );
    assertNear(
      stayed.age,
      start.age + HELD_TICKS * TICK_DT,
      MOTION_EPS,
      `${name}'s age after ${HELD_TICKS} held ticks`,
    );
    assertEqual(
      stayed.contactCooldown,
      0,
      `${name}'s contactCooldown counted out while held`,
    );
    assertNotDeepEqual(
      place(found(moved, id, name)),
      place(stayed),
      `${name}'s position one tick after the switch came on`,
    );
  }
});
