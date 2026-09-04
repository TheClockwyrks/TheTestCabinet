// progression/overlay-closes-to-playing — the acceptance that empties the queue
// returns the game to playing and lets the simulation run again.
//
// THE RULE, FROM THE SPEC. specs/progression.md, Choosing: "Accepting
// decrements pendingLevelUps. When level-ups remain queued the next overlay
// opens immediately ... otherwise screen returns to playing and the simulation
// resumes on the next tick." specs/ui.md, levelup, says the same: "if another
// level-up is queued, the next overlay opens with a fresh set of offers and
// menuIndex = 0; else screen = playing and the simulation resumes on the next
// tick." specs/world.md, One tick, phase 1: "The clock. tick rises by one",
// which is how a resumed simulation shows.
//
// THE POSE. An isolated night with nothing on the field, nothing held, and
// every driver switch off. One level-up is queued through setPendingLevelUps
// and the playing tick that opens the overlay is run; with nothing held the
// pool is the twenty new items, so an offer stands at index 0 whatever the draw
// gave. choose(0) accepts it, emptying the queue, and one frame is then run:
// on levelup a frame ticks nothing (specs/instrumentation.md, A deterministic
// core), so a clock that advanced is a simulation that resumed.
//
// THE TOLERANCE. None: the screen is discrete and the clock is a whole count of
// ticks.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
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

afterEach(() => {
  h?.dispose();
});

it("returns to playing on the last acceptance and ticks the clock on the next frame", async () => {
  isolate(h);

  const overlay = await openLevelUp(h, 1);
  assertEqual(
    overlay.screen,
    "levelup",
    "the overlay the offer is accepted on",
  );
  assertEqual(overlay.run.pendingLevelUps, 1, "the one level-up queued");
  assertGreaterThan(overlay.run.offers.length, 0, "an offer to accept");
  h.debug.choose(0);
  const closed = h.snapshot();

  const after = await h.tick(1);
  captureStill(h, "closed");

  assertEqual(
    closed.screen,
    "playing",
    "the screen the acceptance returned to",
  );
  assertEqual(
    closed.run.pendingLevelUps,
    0,
    "the queue the acceptance emptied",
  );
  assertEqual(
    after.run.tick,
    closed.run.tick + 1,
    "the clock the resumed simulation advanced",
  );
});
