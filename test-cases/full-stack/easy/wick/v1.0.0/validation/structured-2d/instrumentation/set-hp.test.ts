// Wick — instrumentation/set-hp: `setHp(40)` on `playing` reads back
// `player.hp` 40, and `setHp(0)` followed by one `playing` tick ends the run
// fallen through the ending rule.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setHp(hp)`: "Sets `hp` to `hp`, a real number at most `maxHp` ... A value
// at or below `0` ends the run fallen at the end of the next `playing` tick,
// through the ending rule of `specs/world.md`." `specs/world.md`, "Fallen and
// dawn": Fallen — "`hp` is `0` or below", `screen` `fallen`.
//
// THE DRIVE. An isolated run: the pose and a read, then `setHp(0)` and one
// tick, read at its end.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  advanceTicks,
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

afterEach(() => {
  h.dispose();
});

it("poses hp, and hp 0 ends the run fallen on the next tick", async () => {
  isolate(h);
  h.debug.setHp(POSED_HP);
  const posed = h.snapshot();
  await h.frameDraw();
  captureStill(h, "posed");
  assertEqual(posed.run.player.hp, POSED_HP, "player.hp after setHp(40)");
  assertEqual(posed.screen, "playing", "screen after setHp(40)");

  h.debug.setHp(0);
  assertEqual(h.snapshot().screen, "playing", "screen at the setHp(0) call");
  const ended = await advanceTicks(h, 1);
  assertEqual(
    ended.screen,
    "fallen",
    "screen at the end of the tick after setHp(0)",
  );
});
