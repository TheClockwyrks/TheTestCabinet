// rocks/hit-flash — a chipped rock flashes, briefly.
//
// `specs/rocks.md`: "Each hit that leaves a rock standing produces a brief bright
// flash on the struck rock lasting HIT_FLASH_TIME (0.1 seconds), after which the
// rock returns to the appearance its remaining health gives it." It is the only
// feedback a player gets that a round LANDED on an armored rock — without it a
// chipping hit and a miss look exactly alike.
//
// WHAT IS READ, AND AGAINST WHAT. `specs/overview.md` fixes no palette and
// `specs/rocks.md` fixes no colour for the flash, so nothing here may compare the
// canvas against a value of its own. The rock is read TWICE and the two readings
// are compared: once on the tick the hit lands, and once `SETTLE_TIME` later, by
// which time the specification has the flash over and the rock back to the
// appearance its REMAINING health gives it. The second reading is therefore the
// same rock at the same health with no flash on it, which is exactly the baseline
// the rule names — and it is why a build whose damaged look happens to be brighter
// than its undamaged one cannot pass this without flashing.
//
// THE 441 SAMPLES ARE POLAR (`./look.ts`) so that the mean is very nearly
// unaffected by the slow cosmetic rotation `specs/rocks.md` gives every rock, which
// no check can switch off and which turns a little over the fifth of a second
// between the two readings. The rock is re-read before each look, so the samples
// follow it as the well draws it in.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThan,
} from "../assert";
import { HIT_FLASH_TIME, ROCK_HEALTH } from "../constants";
import {
  captureStill,
  createHarness,
  fireAt,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { CHIP_SPOT, chippedRock, healthOf } from "./scene";
import { meanLuminance, readLook } from "./look";

/**
 * How long after the hit the settled reading is taken.
 *
 * Twice `HIT_FLASH_TIME`, so the flash has been over for a whole flash-length by
 * the time the rock is read again and no build is asked to end it early.
 */
const SETTLE_TIME = 2 * HIT_FLASH_TIME;

/**
 * Ticks of quiet observation before the round is fired: twice `HIT_FLASH_TIME`, so
 * the swing the rock's own cosmetic spin puts into a brightness reading is measured
 * over a stretch as long as the flash the check is about.
 */
const QUIET_TICKS = ticksFor(HIT_FLASH_TIME * 2);

/**
 * How many times the quiet window's own swing the flash must clear.
 *
 * The spin's frame-to-frame wobble is what a reading of "brighter" has to be told
 * apart from; three times the largest of it is a rise the spin cannot account for.
 * `specs/rocks.md` gives the rock a slow drawn rotation and leaves its silhouette
 * to the build, so how much that wobble is worth is the build's business and is
 * measured rather than assumed.
 */
const JITTER_MARGIN = 3;

/**
 * The least the flash must rise whatever the quiet window did, out of 255.
 *
 * `specs/rocks.md` calls the flash BRIGHT and puts it there for the player to see,
 * so a change too small to see is not one. A build drawn so steadily that its quiet
 * swing is zero still has to move the rock's mean brightness by this much.
 */
const RISE_FLOOR = 2;

/** How long the round is followed for; its whole flight is the harness's standoff. */
const FLIGHT_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("brightens the struck rock on the tick a chipping hit lands and not a fifth of a second later", async () => {
  await startPlaying(h);
  const id = await poseRock(h, "large", CHIP_SPOT.x, CHIP_SPOT.y);
  const posed = requireRock(await h.snapshot(), id, "the posed Large");

  // THE QUIET WINDOW. It is both the brightness the flash has to rise above and
  // the measure of how much the rock's own cosmetic spin moves that figure from
  // tick to tick — so what "brighter" has to clear is derived from the build's own
  // drawing rather than assumed. Without it, a rock whose drawing merely OSCILLATES
  // can clear a fixed margin on the phase the hit tick happens to fall on.
  const quiet: number[] = [];
  for (let tick = 1; tick <= QUIET_TICKS; tick += 1) {
    await h.advance(1);
    const standing = chippedRock(await h.snapshot(), id, "the quiet window");
    quiet.push(meanLuminance(await readLook(h, standing)));
  }
  const before = quiet.reduce((sum, value) => sum + value, 0) / quiet.length;
  const jitter = Math.max(...quiet.map((value) => Math.abs(value - before)));
  const margin = Math.max(RISE_FLOOR, JITTER_MARGIN * jitter);

  // Put a round on its doorstep and stop on the tick its health first moves.
  await fireAt(h, posed);
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

  const flashing = meanLuminance(await readLook(h, struck));
  await captureStill(h, "flash");

  // A fifth of a second on, the flash is specified to be over.
  await h.advance(ticksFor(SETTLE_TIME));
  const after = chippedRock(await h.snapshot(), id, "a fifth of a second on");
  const settled = meanLuminance(await readLook(h, after));

  assertGreaterThanOrEqual(
    flashing - before,
    margin,
    "how much brighter the struck rock reads on the tick the hit landed than " +
      `over the ${String(QUIET_TICKS)} quiet ticks before the round was ` +
      "fired, in mean luminance over its body — specs/rocks.md gives a " +
      `chipping hit a bright flash. The bound is ${String(JITTER_MARGIN)} ` +
      `times the ${jitter.toFixed(2)} the rock's own spin moved that figure, ` +
      `floored at ${String(RISE_FLOOR)}`,
  );

  assertGreaterThanOrEqual(
    flashing - settled,
    margin,
    "how much brighter the struck rock reads on the hit tick than once the flash is over (specs/rocks.md)",
  );
});
