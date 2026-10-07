// instrumentation/set-hp — `setHp(40)` on playing reads back player.hp 40,
// and `setHp(0)` followed by one playing tick ends the run fallen through the
// ending rule.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setHp`: "Sets `hp`
// to `hp`, a real number at most `maxHp` ... A value at or below `0` ends the
// run fallen at the end of the next `playing` tick, through the ending rule of
// `specs/world.md`". specs/world.md, "Fallen and dawn": "Fallen | `hp` is `0`
// or below | `fallen`".
//
// THE POSE. An isolated run: the first pose read back without a frame, then
// the second and one tick, after which the screen is `fallen` and the run's
// hp is what was posed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const POSED_HP = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets hp, and a pose to 0 ends the run on the next tick", async () => {
  isolate(h);
  h.debug.setHp(POSED_HP);
  assertEqual(h.snapshot().run.player.hp, POSED_HP, "player.hp read back");

  h.debug.setHp(0);
  assertEqual(
    h.snapshot().screen,
    "playing",
    "the screen at the pose, no ending yet",
  );
  const after = await h.tick(1);
  captureStill(h, "posed");

  assertEqual(after.screen, "fallen", "the screen after the next playing tick");
  assertEqual(after.run.player.hp, 0, "player.hp the end screen reports");
});
