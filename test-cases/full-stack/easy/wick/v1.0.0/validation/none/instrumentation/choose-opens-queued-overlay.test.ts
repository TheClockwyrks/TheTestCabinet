// Wick — instrumentation/choose-opens-queued-overlay: on `levelup` with
// `pendingLevelUps` 2, `choose(0)` applies the offer and opens the next overlay
// at once: `screen` still `levelup` with `menuIndex` `0`, `pendingLevelUps` 1,
// and a fresh pool.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `choose(index)`):
// "the item is applied, `pendingLevelUps` falls by one, and either the next
// queued overlay opens with a fresh pool or `screen` returns to `playing`".
// specs/progression.md: "When level-ups remain queued the next overlay opens
// immediately, with a fresh pool drawn from the slots as the acceptance left
// them"; and the pool rule that `candidatePool` restates.
//
// WHY THE WORLD IS POSED AS IT IS. Two level-ups are queued and the first
// overlay opened by the real path; the pool after the acceptance is compared
// to the rule computed over the slots the acceptance left, which is what "as
// the acceptance left them" fixes.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEachIn,
  assertEqual,
  assertLength,
} from "../assert";
import { OFFER_COUNT } from "../constants";
import {
  candidatePool,
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the next queued overlay with a fresh pool", async () => {
  await isolate(h);
  const first = await openLevelUp(h, 2);
  assertEqual(first.screen, "levelup", "the screen the call is made on");
  assertEqual(
    first.run.pendingLevelUps,
    2,
    "pendingLevelUps on the first overlay",
  );

  await h.debug.choose(0);
  const second = await h.snapshot();
  await captureStill(h, "queued");

  assertEqual(
    second.screen,
    "levelup",
    "the screen after choose with one more queued",
  );
  assertEqual(second.menuIndex, 0, "menuIndex on the next overlay");
  assertEqual(second.run.pendingLevelUps, 1, "pendingLevelUps after choose");
  assertEqual(
    second.run.weapons.length + second.run.passives.length,
    1,
    "the item the first choose applied",
  );
  assertDeepEqual(
    second.run.pool,
    candidatePool(second),
    "the pool computed from the slots the acceptance left",
  );
  assertLength(
    second.run.offers,
    OFFER_COUNT,
    "the offers on the next overlay",
  );
  assertEachIn(
    second.run.offers,
    second.run.pool,
    "each offer in the fresh pool",
  );
});
