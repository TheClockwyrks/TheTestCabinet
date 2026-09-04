// Wick — instrumentation/set-enemy-hp-rejects-above-max: on a hound with
// `maxHp` 120, `setEnemyHp(id, 121)` throws and leaves `hp` as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setEnemyHp(id,
// hp)`): "a real number above `0` and at most its `maxHp`; anything else is
// invalid, since death is decided by the tick"; "the call throws rather than
// guessing what was meant". `121` is one past the hound's `maxHp` of `120`.
// The other bound is the sibling point.
//
// WHY THE WORLD IS POSED AS IT IS. The hound is posed alive, so one past the
// hound's maxHp and the whole snapshot can be read exactly across the refused
// call.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import { ENEMIES } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("throws on 121, changing nothing", async () => {
  isolate(h);
  const id = placeEnemy(h, "hound", 300, 0);
  const before = h.snapshot();

  assertThrows(
    () => h.debug.setEnemyHp(id, ENEMIES.hound.hp + 1),
    "setEnemyHp(id, 121)",
  );
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "refused");

  assertDeepEqual(after, before, "the snapshot after the refused call");
});
