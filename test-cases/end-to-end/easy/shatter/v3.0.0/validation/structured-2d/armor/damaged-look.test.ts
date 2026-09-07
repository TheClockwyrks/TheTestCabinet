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
// THE SAME ROCK IS READ TWICE, NOT TWO ROCKS ONCE. A rock's drawn outline and its
// spin are its own — a build is free to derive both from the rock's identity — so
// two rocks standing side by side differ for reasons that have nothing to do with
// health, and a check that compared them would pass any build at all. Instead one
// Large is read at full health, its health is posed down to `1` through
// `setRockHealth`, and it is read again one frame later, so the ONLY thing that
// can have changed between the two readings beyond what one tick does to the
// rock on its own is the look its health gives it. The health is POSED rather
// than shot on, so what is read is the damaged look and not the hit flash
// `armor/hit-flash` grades: `setRockHealth` produces no hit.
//
// THE NOISE FLOOR IS MEASURED, NOT ASSUMED. `specs/rocks.md` gives every rock a
// slow drawn rotation and fixes no rate for it, so the samples inside the rock
// move from tick to tick with nothing happening. Before the health is posed the
// same rock is read across one tick at full health, and how many samples that
// tick redrew is the floor the damaged look has to clear as well as the fixed
// one. A build whose rock spins visibly is held to its own spin, the way
// `armor/hit-flash` holds the flash to it.
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
import { ROCK_HEALTH, ROCK_RADIUS } from "../constants";
import { assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseRock,
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
 * Sixteen is about a twentieth of one channel, far below the contrast of any
 * mark a build would draw to say "damaged"; below it two colours are the same
 * colour to a player. What one tick of the rock's own spin does to the samples
 * is measured rather than assumed, and the count it moves by more than this is
 * the floor the damaged reading has to clear.
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

/** The grid, read off the canvas the last frame drew. */
function readGrid(target: Harness): Rgb[] {
  return SAMPLES.map((point) => {
    const [r, g, b] = target.pixel(point.x, point.y);
    return { r, g, b };
  });
}

/** How many of the 441 samples moved by more than {@link DIFFERENT}. */
function differing(before: readonly Rgb[], after: readonly Rgb[]): number {
  return after.filter(
    (colour, index) => colorDistance(colour, before[index]) > DIFFERENT,
  ).length;
}

it("draws a Large at health 1 differently from the same Large at full health", async () => {
  startPlaying(h);
  const rock = poseRock(h, "large", DAMAGED_SPOT.x, DAMAGED_SPOT.y);

  // THE QUIET TICK. The rock at full health, read one frame apart with nothing
  // happening to it: how many samples the build's own cosmetic spin redraws
  // across one tick is the floor the damaged look has to clear.
  await h.advance(1);
  const quiet = readGrid(h);
  await h.advance(1);
  const whole = readGrid(h);
  const spin = differing(quiet, whole);

  // The same rock, damaged, one frame later.
  poseHealth(h, rock, DAMAGED);
  await h.advance(1);
  const damaged = readGrid(h);

  // And an undamaged one beside it, for the picture alone.
  poseRock(h, "large", WHOLE_SPOT.x, WHOLE_SPOT.y);
  await h.advance(1);
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

  assertGreaterThan(
    differing(whole, damaged),
    Math.max(MIN_DIFFERING, spin),
    `of ${GRID * GRID} points sampled inside the rock's outline, how many ` +
      `are drawn differently at health ${DAMAGED} than at ROCK_HEALTH.large ` +
      `(${FULL}) one tick earlier. specs/rocks.md draws a rock progressively ` +
      "more damaged as its health falls, so a player can judge how many hits " +
      `it has left. The bound is the larger of ${MIN_DIFFERING} and the ` +
      `${spin} the same rock's own spin redrew across one tick at full health`,
  );
});
