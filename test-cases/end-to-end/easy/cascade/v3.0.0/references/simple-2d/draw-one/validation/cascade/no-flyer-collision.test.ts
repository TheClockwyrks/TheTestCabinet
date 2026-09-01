// cascade/no-flyer-collision — two cards in flight pass through one another.
//
// specs/victory.md: "A card in flight collides with nothing ... not another card in
// flight, so two cards crossing the same point keep their velocities through the
// crossing." A cascade puts fifty-two cards over the same table, and they are not a
// crowd of colliding bodies; each one flies its own arc.
//
// TWO CARDS AND NOTHING ELSE. They are aimed at one point from opposite sides at the
// same speed and from the same height, so they meet exactly, overlap completely, and
// separate; a build that resolves an overlap between cards in flight has to change a
// velocity here, and a build that does not is untouched. Both are held clear of the
// floor and of both side edges for the whole crossing, so nothing else can change a
// velocity either.
//
// That they came out the other side is read as well as the velocities: a build that
// stopped both cards dead at the contact keeps `vx` at zero, which is not the pose's
// value, but a build that stopped them by some other means still has to explain the
// card that never got past its partner.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  flyerOf,
  framesFor,
  type Harness,
} from "../harness";
import { openFlight, poseFlyer } from "./flight";

/** The card coming from the left, and the card coming from the right. */
const RIGHTWARD = { x: 200, y: 50, vx: 400, vy: 0, card: "KS" };
const LEFTWARD = { x: 600, y: 50, vx: -400, vy: 0, card: "KH" };

/**
 * The frames run before the picture is kept, and the frames run in all.
 *
 * The two meet half a second in, when each has closed two hundred units. The picture
 * is kept just short of that, where they overlap by more than half a card and both
 * are still visible, and the reading is taken well past it, where each has come out
 * the far side.
 */
const OVERLAP_FRAMES = framesFor(0.45);
const HOLD_FRAMES = framesFor(0.65);

/** How exactly each velocity must survive the crossing, as decimal places. */
const VX_DIGITS = 6;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("lets two cards in flight cross without touching", async () => {
  openFlight(harness);
  const rightward = poseFlyer(harness, RIGHTWARD);
  const leftward = poseFlyer(harness, LEFTWARD);

  await harness.advance(OVERLAP_FRAMES);
  captureStill(harness, "crossing");
  await harness.advance(HOLD_FRAMES - OVERLAP_FRAMES);

  const snapshot = harness.snapshot();
  const first = flyerOf(snapshot, rightward);
  const second = flyerOf(snapshot, leftward);

  assertCloseTo(
    first.vx,
    RIGHTWARD.vx,
    VX_DIGITS,
    "the velocity of the card crossing to the right, after the crossing",
  );
  assertCloseTo(
    second.vx,
    LEFTWARD.vx,
    VX_DIGITS,
    "the velocity of the card crossing to the left, after the crossing",
  );
  assertGreaterThan(
    first.x,
    second.x,
    "the left edge of the rightward card, which has passed the leftward one",
  );
});
