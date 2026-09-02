// armor/damaged-look — a damaged rock reads as damaged.
//
// `specs/rocks.md`, Damage feedback: "A rock is drawn progressively more damaged as
// its health falls, so a player can judge how many hits it has left. A rock at full
// health is drawn undamaged." This item decides that in one direction: a Large
// posed at health `1` is drawn measurably differently from a Large posed at its
// full `ROCK_HEALTH.large` (`3`), everything else about the two frames being the
// same.
//
// WHY IT IS A POINT OF ITS OWN. Every other armor item reads the game's own state.
// This one is the only thing standing between a player and a field of identical
// rocks with invisible health — the exact defect `specs/rocks.md` states the rule
// to prevent, and one no snapshot can see.
//
// THE COMPARISON IS BETWEEN TWO RUNS, NOT TWO ROCKS. A rock's drawn outline and its
// spin are its own — a build is free to derive both from the rock's identity — so
// two rocks standing side by side differ for reasons that have nothing to do with
// health, and a check that compared them would pass any build at all. Instead the
// same arrangement is posed twice, in two harnesses, off the same seed and with the
// same calls in the same order, and the ONLY difference between the two frames is
// the health the left rock was posed at. `specs/instrumentation.md` makes that
// reproducible: given the same seed and the same sequence of calls the game reaches
// the same state every time.
//
// THE SAMPLE IS 441 POINTS INSIDE THE ROCK'S OUTLINE: a 21 by 21 grid over the
// square INSCRIBED in a Large's collision circle, so every point of it lies inside
// the figure the build drew rather than on the field behind it. More than `30` of
// them — a fifteenth — must differ. That is a mark a player sees across a rock
// rather than a recoloured rim or a single crack, and it is small enough that a
// build which shows its damage as a few fissures rather than as a wholesale
// repaint still clears it.
//
// WHAT IS NOT ASSERTED is WHICH way the drawing changed. `specs/rocks.md` leaves
// the look to the build — cracks, a colour, a broken outline are all conformant —
// so the check reads difference and nothing else. The pairing of the two rocks in
// the frame is for the reviewer, who sees a damaged Large beside an undamaged one
// and judges the look itself.

import { afterEach, beforeEach, it } from "vitest";
import { DEFAULT_SEED, ROCK_HEALTH, ROCK_RADIUS } from "../constants";
import { assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseRock,
  resetTo,
  startPlaying,
  type Harness,
  type Rgb,
} from "../harness";
import { poseHealth } from "./scene";

/** Where the rock under test stands, and its undamaged companion in the frame. */
const DAMAGED_SPOT = { x: 280, y: 540 };
const WHOLE_SPOT = { x: 1000, y: 540 };

/** A Large's full health, and the health the left rock is posed at. */
const FULL = ROCK_HEALTH.large;
const DAMAGED = 1;

/** The side of the sample grid: 21 by 21 is the 441 points the item is stated in. */
const GRID = 21;

/**
 * Half the side of the square the grid covers: the square INSCRIBED in a Large's
 * collision circle, so all 441 points lie inside the rock's outline rather than on
 * the field behind it.
 */
const HALF_SIDE = ROCK_RADIUS.large / Math.SQRT2;

/** How many of the 441 must differ for the damage to be legible. */
const MIN_DIFFERING = 30;

/**
 * How far apart two samples must be to count as differing, on the 0–441 scale
 * `colorDistance` measures in.
 *
 * The two frames are produced by the same build off the same seed with the same
 * calls, so a pixel neither rock's health touched is identical in both and reads
 * `0`. This is a guard against a build that dithers its fill rather than a
 * tolerance for noise: sixteen is about a twentieth of one channel, below which two
 * colours are the same colour to a player.
 */
const DIFFERENT = 16;

/** The 441 logical points sampled, in a fixed order, about the rock's centre. */
const SAMPLES: readonly { x: number; y: number }[] = Array.from(
  { length: GRID * GRID },
  (_unused, index) => {
    const column = index % GRID;
    const row = Math.floor(index / GRID);
    const step = (2 * HALF_SIDE) / (GRID - 1);
    return {
      x: DAMAGED_SPOT.x - HALF_SIDE + column * step,
      y: DAMAGED_SPOT.y - HALF_SIDE + row * step,
    };
  },
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Pose the pair of Larges — the left one at `health`, the right one whole — run the
 * frame that draws them, and read the grid off the left one.
 *
 * The same calls in the same order every time, so the two runs this check compares
 * differ in the posed health alone.
 */
async function paint(target: Harness, health: number): Promise<Rgb[]> {
  resetTo(target, DEFAULT_SEED);
  startPlaying(target);
  const damaged = poseRock(target, "large", DAMAGED_SPOT.x, DAMAGED_SPOT.y);
  poseRock(target, "large", WHOLE_SPOT.x, WHOLE_SPOT.y);
  poseHealth(target, damaged, health);
  await target.advance(1);
  return SAMPLES.map((point) => {
    const [r, g, b] = target.pixel(point.x, point.y);
    return { r, g, b };
  });
}

it("draws a Large at health 1 differently from one at full health", async () => {
  const control = await createHarness();
  let whole: Rgb[];
  try {
    whole = await paint(control, FULL);
  } finally {
    control.dispose();
  }

  const damaged = await paint(h, DAMAGED);
  captureStill(h, "damage");

  assertLength(
    whole,
    GRID * GRID,
    "sample points read inside the undamaged Large's outline",
  );
  assertLength(
    damaged,
    GRID * GRID,
    "sample points read inside the damaged Large's outline",
  );

  const differing = damaged.filter(
    (colour, index) => colorDistance(colour, whole[index]) > DIFFERENT,
  ).length;

  assertGreaterThan(
    differing,
    MIN_DIFFERING,
    `of ${GRID * GRID} points sampled inside the rock's outline, how many ` +
      `are drawn differently at health ${DAMAGED} than at ROCK_HEALTH.large ` +
      `(${FULL}) — everything else about the two frames being identical. ` +
      "specs/rocks.md draws a rock progressively more damaged as its health " +
      "falls, so a player can judge how many hits it has left",
  );
});
