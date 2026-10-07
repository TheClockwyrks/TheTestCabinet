// Wick — instrumentation/switch-enemy-motion: with `setEnemyMotion(false)`, a
// moth and a wisp hold their positions and headings across 60 ticks while their
// age and contact cooldown still count; with the switch back on they move from
// the next tick.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The driver
// switches"): "`setEnemyMotion(on)` | `enemyMotion` | Every enemy moves as its
// behavior states ... | Every enemy holds its position and heading. `age` and
// `contactCooldown` still count." specs/enemies.md: "`age` is the seconds since
// it spawned: every tick adds `TICK_DT`"; specs/world.md: a contact cooldown
// "counts down on every tick the enemy is alive". Held positions and headings
// are read exactly; the two timers are sums of `1/60`, read to `TIMER_TOL`.
//
// WHY THE WORLD IS POSED AS IT IS. One chaser and one weaver, the two
// behaviors that recompute a heading, posed well away from the lamplighter so
// motion would be plain; a contact cooldown is posed on the moth so its
// counting is visible. Contact and every other faculty are held.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNear,
  assertNotEqual,
} from "../assert";
import { TICK_DT, TIMER_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  type Harness,
} from "../harness";

const HELD_TICKS = 60;
const POSED_COOLDOWN = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds every enemy still while off, timers counting, and moves them once on", async () => {
  await isolate(h);
  const moth = await placeEnemy(h, "moth", 300, 0);
  const wisp = await placeEnemy(h, "wisp", 0, 300);
  await h.debug.setEnemyContactCooldown(moth.id, POSED_COOLDOWN);
  const before = await h.snapshot();

  const held = await captureReplay(h, "held", () => h.step(HELD_TICKS));
  for (const posed of [moth, wisp]) {
    const was = mustEnemy(before, posed.id);
    const now = mustEnemy(held, posed.id);
    assertEqual(now.x, was.x, `${posed.type} x after ${HELD_TICKS} held ticks`);
    assertEqual(now.y, was.y, `${posed.type} y after ${HELD_TICKS} held ticks`);
    assertDeepEqual(
      now.heading,
      was.heading,
      `${posed.type} heading after ${HELD_TICKS} held ticks`,
    );
    assertNear(
      now.age - was.age,
      HELD_TICKS * TICK_DT,
      TIMER_TOL,
      `${posed.type} age counted over ${HELD_TICKS} held ticks`,
    );
  }
  assertEqual(
    mustEnemy(held, moth.id).contactCooldown,
    0,
    `the moth's contact cooldown after ${HELD_TICKS} held ticks`,
  );

  await h.debug.setEnemyMotion(true);
  const moved = await h.step(1);
  for (const posed of [moth, wisp]) {
    const was = mustEnemy(held, posed.id);
    const now = mustEnemy(moved, posed.id);
    assertNotEqual(
      `${now.x},${now.y}`,
      `${was.x},${was.y}`,
      `${posed.type} position after one tick with enemyMotion on`,
    );
  }
});
