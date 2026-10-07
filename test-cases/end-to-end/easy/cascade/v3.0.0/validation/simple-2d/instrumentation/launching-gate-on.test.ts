// instrumentation/launching-gate-on — with the cascade's launching gated back on,
// the gate reads back on and the same second of game time takes cards off the
// foundations again.
//
// THE RULE. specs/instrumentation.md, The faculty gates: `setLaunching(enabled)`
// gates "The cascade's launch clock and the launching of the next card", and each
// gate "is reported by `snapshot`". specs/victory.md states the faculty: the
// cascade launches a card every `LAUNCH_INTERVAL` (`0.18`) seconds until all
// fifty-two have gone.
//
// WHY THE ON DIRECTION IS ITS OWN POINT, AND WHY IT TURNS THE GATE OFF FIRST. A
// switch that never turns launching back on leaves the ending the game is named
// for dead in normal play, which costs the player something completely different
// from a switch that never turns it off (`instrumentation/launching-gate-off`).
// Setting the gate to `true` from `false` rather than reading the default is what
// makes this a reading of the SWITCH: a build that ignores the operation entirely
// and always launches would otherwise pass on a value it never honoured.
//
// THE BOARD IS THE OFF DIRECTION'S, POSED THE SAME WAY, so nothing separates the
// two points but the gate: four foundations built up to the same rank, on the
// `won` screen, which specs/victory.md makes the only screen a card can leave a
// foundation on.
//
// WHAT IS READ IS THAT CARDS LEFT, NOT HOW MANY OR IN WHAT ORDER. The cadence,
// the launch order and the velocity a card launches with are all `cascade/*`'s;
// this point decides the gate. A second is far more than the `0.18` s the first
// launch needs, so a build that launches at any conformant rate has moved cards
// off the foundations by the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  lastFlyer,
  openTable,
  poseFoundation,
  seconds,
  type Harness,
} from "../harness";

/** The foundation the cascade would launch from, built its whole Ace to King. */
const FOUNDATION = 0;
const FOUNDATION_SUIT = "spades";
const FOUNDATION_UP_TO = 13;

/**
 * The card posed in flight, as its top-left and velocity in logical units.
 *
 * `240` units per second to the right from `x` `200` carries it to `440` over the
 * second, so it stays far inside both side edges and never retires
 * (specs/victory.md). Its `y` is read by nothing here.
 */
const FLYER = { x: 200, y: 200, vx: 240, vy: -600 };

/** The second of game time the item names. */
const HOLD_FRAMES = framesFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Open the won screen with a full foundation, one card in flight, and the gate as given. */
function openCascade(launching: boolean): number {
  openTable(h);
  h.debug.setScreen("won");
  h.debug.setLaunching(launching);
  // The painted layer is not this point's subject, and a full-screen stamp on
  // every one of the second's frames would bury the card the still is of.
  h.debug.setTrailPainting(false);
  poseFoundation(h, FOUNDATION, FOUNDATION_SUIT, FOUNDATION_UP_TO);
  h.debug.addFlyer("hearts", 13, FLYER.x, FLYER.y, FLYER.vx, FLYER.vy);
  return lastFlyer(h.snapshot()).id;
}

it("lets the cascade launch with the gate on", async () => {
  openCascade(true);
  const before = h.snapshot();

  const swept = await h.until((s) => s.launched > before.launched, {
    maxFrames: HOLD_FRAMES,
  });

  // Before the assertions, so a cascade that never started still leaves the
  // picture of the foundations it was watched from.
  captureStill(h, "launching");

  assertEqual(
    swept.hit,
    true,
    "with launching on, a card leaves the foundations within " +
      `${seconds(HOLD_FRAMES)} s of the won screen (specs/victory.md)`,
  );
  assertGreaterThan(
    before.foundations[FOUNDATION].length,
    swept.snapshot.foundations[FOUNDATION].length,
    "the cards left on the foundation the cascade launched from",
  );
});
