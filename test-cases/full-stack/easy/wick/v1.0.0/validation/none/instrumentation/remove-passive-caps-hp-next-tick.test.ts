// Wick — instrumentation/remove-passive-caps-hp-next-tick: with Tallow 2 held
// and `hp` 130, `removePassive` on Tallow's slot reads back `maxHp` 100 with
// `hp` 130 until the next `playing` tick, after which `hp` reads 100.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `removePassive(slot)`): "`hp` is capped at the new `maxHp` on the next
// tick's recovery step." specs/world.md — "Health and recovery": "On every
// tick ... `hp = min(maxHp, hp + recovery × TICK_DT)`", with `recovery` 0 and
// no Tinder held; `maxHp` returns to `BASE_MAX_HP` with Tallow gone.
//
// WHY THE WORLD IS POSED AS IT IS. Tallow is held and `hp` posed to the raised
// maximum, so the cap on removal has something to cut; the pose itself must
// leave `hp` alone, so it is read before the tick as well as after.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BASE_MAX_HP, maxHpOf } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const LEVEL = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("caps hp at the new maxHp on the next tick, not at the call", async () => {
  await isolate(h);
  await h.debug.setPassive(0, "tallow", LEVEL);
  const raised = maxHpOf({ tallow: LEVEL });
  await h.debug.setHp(raised);
  assertEqual(
    (await h.snapshot()).run.player.hp,
    raised,
    "hp at the raised maximum",
  );

  await h.debug.removePassive(0);
  const removed = await h.snapshot();
  assertEqual(removed.run.maxHp, BASE_MAX_HP, "maxHp after the removal");
  assertEqual(removed.run.player.hp, raised, "hp at the call, before the tick");

  const ticked = await h.step(1);
  await captureStill(h, "capped");
  assertEqual(
    ticked.run.player.hp,
    BASE_MAX_HP,
    "hp after the next playing tick",
  );
});
