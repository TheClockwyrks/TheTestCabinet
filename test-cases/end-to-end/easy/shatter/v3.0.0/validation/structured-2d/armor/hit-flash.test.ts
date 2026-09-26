// armor/hit-flash — a chipped rock flashes, and the flash is brief.
//
// `specs/rocks.md`, Damage feedback: "Each hit that leaves a rock standing produces
// a brief bright flash on the struck rock lasting `HIT_FLASH_TIME` (`0.1` seconds),
// after which the rock returns to the appearance its remaining health gives it."
//
// WHAT IS READ, AND AGAINST WHAT. `specs/overview.md` fixes no palette and
// `specs/rocks.md` fixes no colour for the flash, so nothing here compares the
// canvas against a value of its own and nothing here reads a brightness. The rock
// is read TWICE and the two readings are compared: once on the tick the hit lands,
// and once `HIT_FLASH_TIME * 2` later, by which time the specification has the
// flash over and the rock back to the appearance its REMAINING health gives it.
// Both readings are of the same rock at the same health, so the damaged look
// `armor/damaged-look` grades cancels out of the comparison and what is left is the
// flash — the thing the rule says is on one of the two ticks and gone on the other.
//
// THE NOISE FLOOR IS MEASURED, NOT ASSUMED. `specs/rocks.md` gives every rock "a
// slow drawn rotation for visual life", so the samples inside the rock move from
// tick to tick with nothing happening. Before the round is placed the same rock is
// read across a span of exactly the same length with no hit in it, and how many
// samples that span redrew is the floor the flash has to clear as well as the fixed
// one. A build whose rock spins visibly is held to its own spin.
//
// THE SAMPLES FOLLOW THE ROCK. `specs/gravity.md`'s well pulls a rock left at rest,
// so over the scenario it slides a couple of units; every reading is laid on the
// rock's centre as the snapshot reports it on that tick, so the figure is the
// rock's own drawing rather than how much of it happened to be inside a fixed box.
//
// A CHIPPING HIT, NOT A FATAL ONE: the Large arrives at its full
// `ROCK_HEALTH.large` (`3`) and the round leaves it standing, which is the case
// `specs/rocks.md` attaches the flash to.

import { afterEach, beforeEach, it } from "vitest";
import { HIT_FLASH_TIME, ROCK_RADIUS } from "../constants";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
  type Rgb,
} from "../harness";
import { ARMOR_GROUND, chipRock } from "./scene";

/** Ticks run before the quiet span, so nothing of the first frame is in it. */
const SETTLE_TICKS = ticksFor(0.1);

/**
 * The span the flash is read across, and the quiet span too.
 *
 * Twice `HIT_FLASH_TIME`, so the flash has been over for a whole flash-length by
 * the time the rock is read again and no build is asked to end it early.
 */
const SPAN_TICKS = ticksFor(HIT_FLASH_TIME * 2);

/** The side of the sample grid: 21 by 21 is the 441 points this group reads in. */
const GRID = 21;

/**
 * Half the side of the square the grid covers: the square INSCRIBED in a Large's
 * collision circle, so all 441 points lie inside the rock's outline rather than on
 * the field behind it.
 */
const HALF_SIDE = ROCK_RADIUS.large / Math.SQRT2;

/**
 * How far a sample's colour must move to count as changed, on the 0–441 scale
 * `colorDistance` measures in.
 *
 * The figure `armor/damaged-look` reads its own redraw at, so the two pixel checks
 * in this group share one bound: sixteen is about a twentieth of one channel, below
 * which two colours are the same colour to a player.
 */
const SAMPLE_DELTA = 16;

/**
 * How many of the 441 must have moved, whatever the spin did.
 *
 * `armor/damaged-look`'s figure, for the same reason: about seven per cent of the
 * rock, which is enough that a build must really redraw part of it and little
 * enough that a build flashing a rim or a crack rather than the whole body passes.
 */
const MIN_CHANGED = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The 441 points read inside the rock with that id, about where it stands now. */
function look(rockId: number, stage: string): Rgb[] {
  const rock = requireRock(h.snapshot(), rockId, stage);
  const step = (2 * HALF_SIDE) / (GRID - 1);
  const out: Rgb[] = [];
  for (let row = 0; row < GRID; row += 1) {
    for (let column = 0; column < GRID; column += 1) {
      const [r, g, b] = h.pixel(
        rock.x - HALF_SIDE + column * step,
        rock.y - HALF_SIDE + row * step,
      );
      out.push({ r, g, b });
    }
  }
  return out;
}

/** How many of the 441 samples moved by more than {@link SAMPLE_DELTA}. */
function changed(before: readonly Rgb[], after: readonly Rgb[]): number {
  return after.filter(
    (colour, index) => colorDistance(colour, before[index]) > SAMPLE_DELTA,
  ).length;
}

it("redraws the struck rock on the tick the hit lands, and briefly", async () => {
  startPlaying(h);
  const rock = poseRock(h, "large", ARMOR_GROUND.x, ARMOR_GROUND.y);
  await h.advance(SETTLE_TICKS);

  // The quiet span: the same rock, over the same number of ticks, with nothing
  // happening to it. How many samples the build's own cosmetic spin redraws across
  // that span is the floor the flash has to clear.
  const quietFrom = look(rock, "the rock at the start of the quiet span");
  await h.advance(SPAN_TICKS);
  const quietTo = look(rock, "the rock at the end of the quiet span");
  const spin = changed(quietFrom, quietTo);

  const chip = await chipRock(h, rock);
  requireRock(
    chip.at,
    rock,
    "the Large still standing on the tick the round landed, which is the case " +
      "specs/rocks.md attaches the flash to",
  );

  const flashing = look(rock, "the rock on the tick the hit landed");
  captureStill(h, "flash");

  await h.advance(SPAN_TICKS);
  const settled = look(rock, "the rock once the flash has run out");

  assertGreaterThan(
    changed(flashing, settled),
    Math.max(MIN_CHANGED, spin),
    `of ${GRID * GRID} samples inside the rock's outline, how many the build ` +
      "drew differently on the tick the hit landed from " +
      `${HIT_FLASH_TIME * 2} s later, once specs/rocks.md has the flash over ` +
      "and the rock back to the appearance its remaining health gives it. " +
      `The bound is the larger of ${MIN_CHANGED} and the ${spin} the same ` +
      "rock's own spin redrew across a span of the same length with no hit " +
      "in it",
  );
});
