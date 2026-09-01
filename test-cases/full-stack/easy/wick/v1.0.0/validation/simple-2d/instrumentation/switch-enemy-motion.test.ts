// instrumentation/switch-enemy-motion — with `setEnemyMotion(false)`, a moth
// and a wisp hold their positions and headings across 60 ticks while their age
// and contactCooldown still count; with the switch back on they move from the
// next tick.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The driver
// switches", `enemyMotion` off: "Every enemy holds its position and heading.
// `age` and `contactCooldown` still count"; "turning one back on resumes that
// faculty from the next tick". specs/enemies.md: `age` grows "by `TICK_DT` per
// tick"; a chaser's step is "`speed * TICK_DT` units" toward the lamplighter,
// the moth's speed 100. specs/world.md, "Timers": a 0.5 s timer is due 30
// ticks on, held at 0 after.
//
// THE POSE. An isolated run; a moth at (200, 0) and a wisp at (0, 200) with
// the lamplighter at the origin; the moth's contact cooldown posed to 0.5 so
// there is a timer to watch. Sixty ticks: positions and headings unchanged,
// age 1.0, the cooldown run down to 0. Then the switch on and one tick: the
// moth has stepped 100 × TICK_DT toward the origin and the wisp has moved.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertDefined,
  assertEqual,
  assertNotDeepEqual,
  assertWithin,
} from "../assert";
import { ENEMIES, MOTION_TOLERANCE, TICK_DT } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  enemyById,
  isolate,
  spawnEnemyAt,
  type Harness,
} from "../harness";

const HELD_TICKS = 60;
const MOTH_X = 200;
const WISP_Y = 200;
const POSED_COOLDOWN = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds both enemies still while their timers count, then lets them move", async () => {
  isolate(h);
  const moth = spawnEnemyAt(h, "moth", MOTH_X, 0);
  const wisp = spawnEnemyAt(h, "wisp", 0, WISP_Y);
  h.debug.setEnemyContactCooldown(moth, POSED_COOLDOWN);
  const posed = h.snapshot();

  const held = await captureReplay(h, "held", () => h.tick(HELD_TICKS));
  for (const [name, id] of [
    ["moth", moth],
    ["wisp", wisp],
  ] as const) {
    const before = enemyById(posed, id);
    const after = enemyById(held, id);
    assertDefined(after, `the ${name} after 60 held ticks`);
    assertEqual(after?.x, before?.x, `the ${name}'s x, held`);
    assertEqual(after?.y, before?.y, `the ${name}'s y, held`);
    assertDeepEqual(
      after?.heading,
      before?.heading,
      `the ${name}'s heading, held`,
    );
    assertWithin(
      after?.age ?? Number.NaN,
      HELD_TICKS * TICK_DT,
      MOTION_TOLERANCE,
      `the ${name}'s age after 60 held ticks`,
    );
  }
  assertEqual(
    enemyById(held, moth)?.contactCooldown,
    0,
    "the moth's contactCooldown, counted down to 0 while held",
  );

  enable(h, "enemyMotion");
  const moved = await h.tick(1);
  assertWithin(
    enemyById(moved, moth)?.x ?? Number.NaN,
    MOTH_X - ENEMIES.moth.speed * TICK_DT,
    MOTION_TOLERANCE,
    "the moth's x after one tick with enemyMotion on",
  );
  const wispAfter = enemyById(moved, wisp);
  assertNotDeepEqual(
    { x: wispAfter?.x, y: wispAfter?.y },
    { x: 0, y: WISP_Y },
    "the wisp's position after one tick with enemyMotion on",
  );
});
