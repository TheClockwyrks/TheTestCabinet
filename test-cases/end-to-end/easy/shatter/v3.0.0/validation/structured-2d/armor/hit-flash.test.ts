// armor/hit-flash — a chipped rock flashes, and the flash is brief.
//
// `specs/rocks.md`, Damage feedback: "Each hit that leaves a rock standing produces
// a brief bright flash on the struck rock lasting `HIT_FLASH_TIME` (`0.1` seconds),
// after which the rock returns to the appearance its remaining health gives it."
// This item decides that the flash is BRIGHT and that it is BRIEF, which is one
// requirement read in one direction: the rock's drawn pixels on the tick the hit
// landed are measurably brighter than the same rock's before the round was fired
// AND than the same rock's `0.2` seconds later, twice `HIT_FLASH_TIME` on.
//
// BOTH NEIGHBOURS, BECAUSE EITHER ALONE PASSES A DIFFERENT WRONG BUILD. A build
// that never flashes fails the first comparison; a build that flashes and never
// stops — which is the same defect a player sees as a rock stuck bright — fails the
// second and only the second. And measuring the flash against the rock's OWN
// appearance on both sides is what keeps this independent of `armor/damaged-look`:
// nothing here assumes a chipped rock is drawn lighter or darker than a whole one,
// only that the flash tick is brighter than what stands either side of it.
//
// THE NOISE FLOOR IS MEASURED, NOT ASSUMED. `specs/rocks.md` gives every rock "a
// slow drawn rotation for visual life", so the pixels inside the reading box change
// from tick to tick even with nothing happening. The quiet window before the round
// is fired measures exactly how much, and the flash has to clear that swing several
// times over. A build whose rock is drawn perfectly steadily still has to clear the
// absolute floor below, so a zero-jitter build cannot pass on an imperceptible
// change.
//
// THE BOX FOLLOWS THE ROCK. `specs/gravity.md`'s well pulls a rock left at rest, so
// over the scenario it slides a couple of units; every reading is taken about the
// rock's centre as the snapshot reports it on that tick, so the figure is the
// rock's brightness rather than how much of it happened to be inside a fixed box.
//
// A CHIPPING HIT, NOT A FATAL ONE: the Large arrives at its full
// `ROCK_HEALTH.large` (`3`) and the round leaves it standing, which is the case
// `specs/rocks.md` attaches the flash to. That it survived is asserted as the
// PRECONDITION and nothing more about its health is read — what the health then
// reads is `armor/health-falls-by-one`'s point.

import { afterEach, beforeEach, it } from "vitest";
import { HIT_FLASH_TIME, ROCK_HEALTH, ROCK_RADIUS } from "../../src/constants";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  meanLuminance,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { ARMOR_GROUND, chipRock } from "./scene";

/** The hits a Large carries, from which one round leaves it standing. */
const FULL = ROCK_HEALTH.large;

/**
 * The radius of the box every brightness reading is taken over: a Large's whole
 * collision circle plus a margin, so the rock stays wholly inside it even as the
 * well slides it a unit or two over the scenario.
 */
const GLOW_R = ROCK_RADIUS.large + 8;

/** Ticks run before the quiet window, so nothing of the first frame is in it. */
const SETTLE_TICKS = ticksFor(0.1);

/**
 * Ticks of quiet observation before the round is fired: twice `HIT_FLASH_TIME`, so
 * the swing the rock's own cosmetic spin produces is measured over a stretch as
 * long as the flash the check is about.
 */
const QUIET_TICKS = ticksFor(HIT_FLASH_TIME * 2);

/**
 * How many times the quiet window's own swing the flash must clear.
 *
 * The spin's frame-to-frame wobble is what a reading of "brighter" has to be
 * distinguished from; three times the largest of it is a rise that cannot be the
 * spin.
 */
const JITTER_MARGIN = 3;

/**
 * The absolute floor the rise must clear whatever the quiet window measured, in
 * units of mean luminance on the 0–255 scale.
 *
 * `specs/rocks.md` calls the flash BRIGHT and puts it there for the player to see,
 * so a change too small to see is not one. A build drawn so steadily that its quiet
 * swing is zero still has to move the rock's mean brightness by this much.
 */
const RISE_FLOOR = 2;

/**
 * When the rock is read again: twice `HIT_FLASH_TIME`, so the flash
 * `specs/rocks.md` gives `0.1` seconds has had that long again to be over.
 */
const AFTER_TICKS = ticksFor(HIT_FLASH_TIME * 2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** How bright the rock with that id is drawn, over the box around where it stands. */
function glow(rockId: number, stage: string): number {
  const rock = requireRock(h.snapshot(), rockId, stage);
  return meanLuminance(h, rock.x, rock.y, GLOW_R);
}

it("brightens the struck rock on the tick the hit lands, and briefly", async () => {
  startPlaying(h);
  const rock = poseRock(h, "large", ARMOR_GROUND.x, ARMOR_GROUND.y);
  await h.advance(SETTLE_TICKS);

  // The quiet window: the rock drawn with nothing happening to it, which is both
  // the brightness the flash has to rise above and the measure of how much the
  // rock's own cosmetic spin moves that figure tick to tick.
  const quiet: number[] = [];
  for (let tick = 1; tick <= QUIET_TICKS; tick += 1) {
    await h.advance(1);
    quiet.push(glow(rock, "the rock in the quiet window before the round"));
  }
  const before = quiet.reduce((sum, value) => sum + value, 0) / quiet.length;
  const jitter = Math.max(...quiet.map((value) => Math.abs(value - before)));
  const margin = Math.max(RISE_FLOOR, JITTER_MARGIN * jitter);

  const chip = await chipRock(h, rock);
  const standing = requireRock(
    chip.at,
    rock,
    `the Large, one of its ROCK_HEALTH.large (${FULL}) hits spent and still ` +
      "standing on the tick the round landed, which is the case " +
      "specs/rocks.md attaches the flash to",
  );

  const flash = meanLuminance(h, standing.x, standing.y, GLOW_R);
  captureStill(h, "flash");

  await h.advance(AFTER_TICKS);
  const after = glow(rock, "the rock once the flash has run out");

  assertGreaterThanOrEqual(
    flash - before,
    margin,
    "how much brighter the struck rock is drawn on the tick the hit landed " +
      `than in the ${QUIET_TICKS} ticks before the round, in mean luminance ` +
      `over its own circle: specs/rocks.md gives a chipping hit a bright ` +
      `flash. The bound is ${JITTER_MARGIN} times the ` +
      `${jitter.toFixed(2)} the rock's own spin moved that figure, floored ` +
      `at ${RISE_FLOOR}`,
  );
  assertGreaterThanOrEqual(
    flash - after,
    margin,
    "how much brighter that same tick is than the same rock " +
      `${HIT_FLASH_TIME * 2} s later: specs/rocks.md makes the flash BRIEF, ` +
      `lasting HIT_FLASH_TIME (${HIT_FLASH_TIME} s), after which the rock ` +
      "returns to the appearance its remaining health gives it",
  );
});
