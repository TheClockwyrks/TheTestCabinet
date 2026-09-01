// Wick — progression/overlay-closes-to-playing: the last acceptance returns to
// `playing` and the simulation resumes.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`,
// "Choosing": "otherwise `screen` returns to `playing` and the simulation
// resumes on the next tick." "The level-up overlay": "the simulation does not
// tick while it is open". `specs/instrumentation.md`, `choose(index)`: "either
// the next queued overlay opens with a fresh pool or `screen` returns to
// `playing`".
//
// THE POSE. An isolated `playing` run holding nothing with exactly one level-up
// queued, so the acceptance is the last one. `setNextOffers(["shard"])` fixes
// the single offer to an unheld base weapon, which a free weapon slot makes a
// candidate. That the simulation resumed is read from the run clock: one tick
// is run after the acceptance and `tick` must have advanced by one, which it
// does not while an overlay stands open.
//
// THE TOLERANCE. Exact: a screen name, a whole queue length, and a whole tick
// count.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import type { OfferId } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

const OFFERS: OfferId[] = ["shard"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("returns to playing on the last acceptance and ticks again", async () => {
  isolate(h);
  h.debug.setNextOffers(OFFERS);

  const overlay = await openLevelUp(h, 1);
  assertDeepEqual(overlay.run.offers, OFFERS, "the overlay's offers");

  h.debug.choose(0);
  const closed = h.snapshot();
  const resumed = await advanceTicks(h, 1);
  captureStill(h, "closed");

  assertEqual(
    closed.screen,
    "playing",
    "screen after the last acceptance (specs/progression.md, Choosing)",
  );
  assertEqual(
    closed.run.pendingLevelUps,
    0,
    "run.pendingLevelUps after the last acceptance",
  );
  assertEqual(
    resumed.run.tick,
    closed.run.tick + 1,
    "run.tick one tick after the overlay closed",
  );
});
