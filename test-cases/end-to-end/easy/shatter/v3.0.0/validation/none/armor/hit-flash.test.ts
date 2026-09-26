// rocks/hit-flash — a chipped rock flashes, briefly.
//
// `specs/rocks.md`: "Each hit that leaves a rock standing produces a brief bright
// flash on the struck rock lasting HIT_FLASH_TIME (0.1 seconds), after which the
// rock returns to the appearance its remaining health gives it." It is the only
// feedback a player gets that a round LANDED on an armored rock — without it a
// chipping hit and a miss look exactly alike.
//
// WHAT IS READ, AND AGAINST WHAT. `specs/overview.md` fixes no palette and
// `specs/rocks.md` fixes no colour for the flash, so nothing here compares the
// canvas against a value of its own and nothing here reads a brightness. The rock
// is read TWICE and the two readings are compared: once on the tick the hit lands,
// and once `SETTLE_TIME` later, by which time the specification has the flash over
// and the rock back to the appearance its REMAINING health gives it. Both readings
// are of the same rock at the same health, so the damaged look cancels out of the
// comparison and what is left is the flash — the thing the rule says is there on
// one of the two ticks and gone on the other.
//
// THE NOISE FLOOR IS MEASURED, NOT ASSUMED. `specs/rocks.md` gives every rock a
// slow drawn rotation, which is cosmetic and which no check can switch off, so the
// samples move from tick to tick with nothing happening. Before the round is fired
// the same rock is read across a span of exactly the same length with no hit in it,
// and how many samples that span redrew is the floor the flash has to clear as well
// as the fixed one. A build whose rock spins visibly is held to its own spin.
//
// THE 441 SAMPLES ARE POLAR (`./look.ts`) so they cover the rock's whole body
// rather than a patch of it, and the rock is re-read before each look, so the
// samples follow it as the well draws it in.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { HIT_FLASH_TIME, ROCK_HEALTH } from "../constants";
import {
  captureStill,
  createHarness,
  fireAt,
  poseRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { CHIP_SPOT, chippedRock, healthOf } from "./scene";
import { changedSamples, LOOK_SAMPLES, readLook } from "./look";

/**
 * How long after the hit the settled reading is taken.
 *
 * Twice `HIT_FLASH_TIME`, so the flash has been over for a whole flash-length by
 * the time the rock is read again and no build is asked to end it early.
 */
const SETTLE_TIME = 2 * HIT_FLASH_TIME;

/** That span in ticks: the span the flash is read across and the quiet span too. */
const SETTLE_TICKS = ticksFor(SETTLE_TIME);

/**
 * How far a sample's colour must move to count as changed, of the 441 a colour
 * distance can span.
 *
 * The figure `armor/damaged-look` reads its own redraw at, so the two pixel checks
 * in this group share one bound: well above what a tick of the rock's slow cosmetic
 * rotation does to an anti-aliased edge, and far below the contrast of any mark a
 * build would draw to say "struck".
 */
const SAMPLE_DELTA = 16;

/**
 * How many of the {@link LOOK_SAMPLES} must have moved, whatever the spin did.
 *
 * `armor/damaged-look`'s figure, for the same reason: about seven per cent of the
 * rock, which is enough that a build must really redraw part of it and little
 * enough that a build flashing a rim or a crack rather than the whole body passes.
 */
const MIN_CHANGED = 30;

/** How long the round is followed for; its whole flight is the harness's standoff. */
const FLIGHT_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("redraws the struck rock on the tick a chipping hit lands and not a fifth of a second later", async () => {
  await startPlaying(h);
  const id = await poseRock(h, "large", CHIP_SPOT.x, CHIP_SPOT.y);

  // THE QUIET SPAN. The same rock, over the same number of ticks, with nothing
  // happening to it: how many samples the build's own cosmetic spin redraws across
  // that span is the floor the flash has to clear. Without it a rock drawn with a
  // fast spin would pass this check having never flashed at all.
  await h.advance(1);
  const opening = chippedRock(await h.snapshot(), id, "the quiet span");
  const quietFrom = await readLook(h, opening);
  await h.advance(SETTLE_TICKS);
  const closing = chippedRock(await h.snapshot(), id, "the quiet span");
  const quietTo = await readLook(h, closing);
  const spin = changedSamples(quietFrom, quietTo, SAMPLE_DELTA);

  // Put a round on its doorstep and stop on the tick its health first moves.
  await fireAt(h, closing);
  const landed = await h.until(
    (snapshot) => {
      const struck = snapshot.rocks.find((entry) => entry.id === id);
      return (
        struck === undefined ||
        (struck.health ?? ROCK_HEALTH.large) < ROCK_HEALTH.large
      );
    },
    { maxTicks: FLIGHT_TICKS, poll: 1 },
  );
  assertEqual(landed.hit, true, "the round landed on the Large");
  const struck = chippedRock(landed.snapshot, id, "the chipping round");
  assertLessThan(
    healthOf(struck, "the chipped Large"),
    ROCK_HEALTH.large,
    "the health the hit took off (specs/rocks.md)",
  );

  const flashing = await readLook(h, struck);
  await captureStill(h, "flash");

  // A fifth of a second on, the flash is specified to be over.
  await h.advance(SETTLE_TICKS);
  const after = chippedRock(await h.snapshot(), id, "a fifth of a second on");
  const settled = await readLook(h, after);

  assertGreaterThan(
    changedSamples(flashing, settled, SAMPLE_DELTA),
    Math.max(MIN_CHANGED, spin),
    `of ${LOOK_SAMPLES} samples inside the rock's outline, how many the build drew differently on the tick the hit landed from ${SETTLE_TIME} s later, once specs/rocks.md has the flash over and the rock back to the appearance its remaining health gives it. The bound is the larger of ${MIN_CHANGED} and the ${spin} the same rock's own spin redrew across a span of the same length with no hit in it`,
  );
});
