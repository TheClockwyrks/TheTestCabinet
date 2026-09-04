// cascade/floor-bounce-reflects — the floor turns a descending card around.
//
// specs/victory.md's third per-frame step: when a card in flight is at or below
// `FLOOR_Y` while its vertical velocity is downward, that velocity is reversed. So
// a card driven down onto the floor leaves it going up, and the cascade's cards
// bounce along the bottom of the table rather than sinking through it.
//
// THE READING IS TAKEN AT A FIXED SPAN, not at a frame this check went looking
// for, so what it decides is that the card is ascending after the floor was
// reached and nothing about when. The span is chosen so the card is on its way up
// whatever the build's gravity: it is well past the contact even with no
// acceleration at all, and well short of a second contact even with twice the
// stated acceleration. That keeps this point clear of `gravity`, which is a
// different requirement.
//
// The card is held still horizontally so no side edge can retire it mid-flight,
// and how far the bounce damps it, where it is seated, and what happens to its
// horizontal drift are the three sibling points; this one decides the reversal
// alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan } from "../assert";
import { FLOOR_Y } from "../constants";
import { captureReplay, type Harness } from "../harness";
import {
  createFlightHarness,
  flightFrames,
  flyerOf,
  openFlight,
  poseFlight,
} from "./flight";

/**
 * Where the card starts, and how fast.
 *
 * A moderate descent from a moderate height, held still horizontally. The drop is
 * `150` logical units, so the floor is reached inside a fifth of a second at the
 * stated acceleration and inside a quarter of one with no acceleration at all.
 */
const START = { x: 590, y: FLOOR_Y - 150, vx: 0, vy: 600 };

/**
 * How long the card is flown for, in seconds.
 *
 * Past the contact and short of the next one under any plausible acceleration:
 * with no gravity the card reaches the floor at `0.25` s and never returns to it;
 * at the stated gravity it bounces at about `0.19` s and does not come back for
 * another eight tenths of a second; at twice the stated gravity it bounces at
 * about `0.17` s and is still climbing at `0.43` s.
 */
const HOLD_FRAMES = flightFrames(0.4);

let harness: Harness;

beforeEach(async () => {
  harness = await createFlightHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("sends a card that reaches the floor back upward", async () => {
  openFlight(harness);
  const id = poseFlight(harness, START);

  const vy = await captureReplay(harness, "bounce", async () => {
    await harness.advance(HOLD_FRAMES);
    return flyerOf(harness.snapshot(), id).vy;
  });

  assertLessThan(
    vy,
    0,
    "the vertical velocity of a card driven onto the floor, which is upward " +
      "once the floor has turned it around",
  );
});
