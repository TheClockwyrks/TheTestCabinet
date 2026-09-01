// Wick — instrumentation/clear-pickups: `clearPickups()` with a chest, bread,
// and a draft on the field leaves `pickups` empty, `hp` unchanged, no gem
// attracted, and no overlay opened.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `clearPickups()`): "Removes every pickup; nothing is collected." What a
// collection would do is specs/world.md's table: a chest "Opens the chest
// overlay", bread "Heals `BREAD_HEAL` (`30`)", a draft makes "Every gem on the
// field ... attracted"; so each of those three is read across the clear.
//
// WHY THE WORLD IS POSED AS IT IS. One pickup of each kind, `hp` lowered so a
// heal would show, and an unattracted gem out of pickup range so a draft's
// attraction would show; the screen is read too, for the chest.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  gemById,
  isolate,
  placeGem,
  placePickup,
  type Harness,
} from "../harness";

const POSED_HP = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes every pickup without collecting any", async () => {
  await isolate(h);
  await h.debug.setHp(POSED_HP);
  const gem = await placeGem(h, "medium", 400, 0);
  await placePickup(h, "chest", 200, 0);
  await placePickup(h, "bread", -200, 0);
  await placePickup(h, "draft", 0, 200);
  assertLength(
    (await h.snapshot()).run.pickups,
    3,
    "the pickups before the clear",
  );

  await h.debug.clearPickups();
  const after = await h.snapshot();
  await captureStill(h, "cleared");
  assertLength(after.run.pickups, 0, "the pickups after clearPickups()");
  assertEqual(after.run.player.hp, POSED_HP, "hp across the clear");
  assertEqual(
    gemById(after, gem.id)?.attracted,
    false,
    "the gem's attraction across the clear",
  );
  assertEqual(after.screen, "playing", "the screen across the clear");
});
