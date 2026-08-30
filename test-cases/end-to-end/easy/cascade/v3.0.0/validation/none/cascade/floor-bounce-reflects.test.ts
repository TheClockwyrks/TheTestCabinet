// cascade/floor-bounce-reflects — a card in flight bounces off the floor.
//
// specs/victory.md's third step of every frame: "If `y >= FLOOR_Y` (`580`) while
// `vy` is greater than zero, then `vy = -vy * BOUNCE_DAMP` ... and
// `y = FLOOR_Y`." The sign is the whole of what this point reads: a card that
// was descending is ascending on the other side of the floor. How much speed the
// bounce keeps is `floor-bounce-damps`, where the card ends up is
// `floor-bounce-seats`, and what happens to `vx` is `floor-bounce-keeps-vx`.
//
// The card is dropped from rest three hundred units above the floor on an empty
// table with nothing launching, so the only thing that can reverse `vy` is the
// bounce the point is about. With no horizontal drift it cannot reach a side
// edge, so it cannot retire instead of bouncing — a build that swallowed the
// card at the floor fails here with the flight empty rather than with a stale
// reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { FLOOR_Y } from "../constants";
import {
  type Harness,
  captureReplay,
  createHarness,
  flyerById,
  framesFor,
  poseFlyer,
  requireFlyer,
} from "../harness";
import { openFlight } from "./flight";

/** A card dropped from rest, 300 units above the floor. */
const DROP = { x: 400, y: FLOOR_Y - 300, vx: 0, vy: 0 };

/**
 * How far the sweep runs, in frames.
 *
 * The fall is `sqrt(2 * 300 / GRAVITY)` = `0.577` s at the acceleration
 * `specs/victory.md` fixes; `0.8` s is comfortable room over it and a bound on
 * the sweep rather than a reading of the fall.
 */
const SWEEP_FRAMES = framesFor(0.8);

/** Frames of the rebound recorded after it, so the replay shows the card leave. */
const DEPARTURE_FRAMES = framesFor(0.4);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("sends a descending flyer back up off the floor", async () => {
  await openFlight(harness);
  const id = await poseFlyer(harness, DROP);

  const bounce = await captureReplay(harness, "bounce", async () => {
    const rebound = await harness.until(
      (s) => (flyerById(s, id)?.vy ?? 0) < 0,
      { maxFrames: SWEEP_FRAMES, poll: 1 },
    );
    await harness.advance(DEPARTURE_FRAMES);
    return rebound;
  });

  assertEqual(
    bounce.hit,
    true,
    "the dropped card to leave the floor ascending",
  );
  const rebounded = requireFlyer(bounce.snapshot, id, "bouncing off the floor");
  assertLessThan(
    rebounded.vy,
    0,
    "the vy of the card on the frame it met the floor, which is upward on a stage whose y grows downward",
  );
  // And it really had been coming down: a card that was already rising would
  // make the reading above say nothing at all.
  assertGreaterThan(
    bounce.frames,
    0,
    "the card to have fallen before it bounced, in frames",
  );
});
