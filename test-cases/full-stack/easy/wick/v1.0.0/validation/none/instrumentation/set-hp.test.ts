// Wick — instrumentation/set-hp: `setHp(40)` on `playing` reads back
// `player.hp` 40, and `setHp(0)` followed by one `playing` tick ends the run
// fallen through the ending rule.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setHp(hp)`):
// "Sets `hp` to `hp`, a real number at most `maxHp` ... A value at or below
// `0` ends the run fallen at the end of the next `playing` tick, through the
// ending rule of `specs/world.md`." specs/world.md — "Fallen and dawn": "Fallen
// | `hp` is `0` or below. | `fallen`".
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night, so the one tick run
// after `setHp(0)` has nothing but the ending rule to act on; the pose itself
// must NOT end the run, so the screen is read before the tick too.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

const POSED_HP = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses health, and a posed 0 ends the run on the next tick", async () => {
  await isolate(h);
  await h.debug.setHp(POSED_HP);
  const posed = await h.snapshot();
  await captureStill(h, "posed");
  assertEqual(posed.run.player.hp, POSED_HP, "hp after setHp(40)");

  await h.debug.setHp(0);
  const zeroed = await h.snapshot();
  assertEqual(zeroed.run.player.hp, 0, "hp after setHp(0)");
  assertEqual(zeroed.screen, "playing", "the screen at the pose, before the tick");

  const ended = await h.step(1);
  assertEqual(ended.screen, "fallen", "the screen after one playing tick at hp 0");
});
