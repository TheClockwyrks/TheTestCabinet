// instrumentation/launching-gate-on — with the cascade's launching gated back on,
// the gate reads back on and the same second of game time takes cards off the
// foundations again.
//
// THE RULE. `specs/instrumentation.md`, The faculty gates: `setLaunching(enabled)`
// gates "The cascade's launch clock and the launching of the next card", and each
// gate "is reported by `snapshot`". `specs/victory.md` states the faculty: the
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
// `won` screen, which `specs/victory.md` makes the only screen a card can leave a
// foundation on.
//
// WHAT IS READ IS THAT CARDS LEFT, NOT HOW MANY OR IN WHAT ORDER. The cadence,
// the launch order and the velocity a card launches with are all `cascade/*`'s;
// this point decides the gate. A second is far more than the `0.18` s the first
// launch needs, so a build that launches at any conformant rate has moved cards
// off the foundations by the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { SUITS } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  openTable,
  poseFoundation,
  type Harness,
} from "../harness";

/** How far each of the four foundations is built up before the gate goes on. */
const FOUNDATION_UP_TO = 5;

/** The span the gate is held over, in seconds. */
const SPAN_SECONDS = 1;

/** The cards on the four foundations, as one count. */
function home(piles: readonly { length: number }[]): number {
  return piles.reduce((n, pile) => n + pile.length, 0);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the gate on again and launches cards off the foundations", async () => {
  await openTable(h);
  for (const [index, suit] of SUITS.entries()) {
    await poseFoundation(h, index, suit, FOUNDATION_UP_TO);
  }
  // The cascade runs on the `won` screen (`specs/victory.md`), which is the only
  // screen on which a card could leave a foundation at all.
  await h.debug.setScreen("won");
  // Off and then on, so what is read is the operation rather than a default.
  await h.debug.setLaunching(false);
  await h.debug.setLaunching(true);

  assertEqual(
    (await h.snapshot()).launching,
    true,
    "snapshot().launching after setLaunching(true) followed " +
      "setLaunching(false): each gate is reported by snapshot " +
      "(specs/instrumentation.md)",
  );

  const before = await h.snapshot();
  await h.advance(framesFor(SPAN_SECONDS));
  const after = await h.snapshot();

  // Before the assertions, so a cascade that never started still leaves the
  // picture of the foundations it should have emptied.
  await captureStill(h, "launching");

  assertLessThan(
    home(after.foundations),
    home(before.foundations),
    `the cards left on the four foundations after ${SPAN_SECONDS} s on the ` +
      `won screen with setLaunching(true), against the ` +
      `${home(before.foundations)} they held before it — with the gate on the ` +
      `cascade launches again (specs/instrumentation.md, specs/victory.md), so ` +
      `a build that never launches fails here rather than passing on a gate it ` +
      `ignores`,
  );
  assertGreaterThan(
    after.launched,
    before.launched,
    `the cards the cascade counted out over that second, against the count ` +
      `before it — the gate restores the launch clock and the launching of the ` +
      `next card (specs/instrumentation.md)`,
  );
});
