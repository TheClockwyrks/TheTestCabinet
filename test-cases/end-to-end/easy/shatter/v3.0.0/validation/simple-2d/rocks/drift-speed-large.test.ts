// rocks/drift-speed-large — a wave puts its Larges up inside their speed range.
//
// `specs/rocks.md`, The three sizes: a rock's "base drift speed is the speed it
// enters the field with, drawn uniformly from its size's range", and the table gives
// `large` `ROCK_SPEED_MIN.large` to `ROCK_SPEED_MAX.large` (`60` to `110`).
// `specs/progression.md` says what a wave then does with that figure: each rock's
// speed is a Large's base drift speed multiplied by
// `1 + min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (N - 1))`. This item decides that a
// wave's Large rocks enter inside the range their size fixes, scaled by the wave
// they belong to; that the scaling actually rises from wave to wave, and that it
// stops rising, are `waves/speed-scales-per-wave` and `waves/speed-is-capped`.
//
// THE WAVE IS A REAL ONE, WHICH IS WHY THIS CHECK DOES NOT USE `startPlaying`. The
// speed a wave draws is written by the game's own wave loop, and no pose can produce
// it — `setWave` spawns nothing. So the game is opened the way a player opens it:
// `reset` to the title, then the real confirm key on the highlighted `PLAY`. That
// route leaves both world gates on, which is exactly the requirement here, and it is
// the one place in this group where the wave loop runs at all.
//
// THE SPEEDS ARE READ ON THE TICK THE ROCKS APPEAR. `specs/gravity.md` pulls every
// rock, so a reading taken a second later would be a reading of the well; the sweep
// samples every tick and stops on the first that holds a rock, so at most one tick of
// pull stands between the draw and the number. `specs/progression.md` places every
// wave rock at least `WAVE_MIN_STAR_DIST` (`200`) from the star, where the pull is at
// most `MU / 200^2` = `112.5` units per second squared — under one unit per second in
// a tick, which is what {@link WELL_SLACK} allows for.
//
// THE MULTIPLIER IS READ OFF THE GAME'S OWN WAVE NUMBER rather than assumed to be
// one, so the window is the specification's formula and not this file's guess at
// which wave the build opened on. On wave 1 the multiplier is `1` by
// `specs/progression.md`'s own arithmetic.
//
// AT LEAST ONE LARGE IS REQUIRED TO EXIST. "Every Large a wave spawns" says nothing
// about a wave with none in it, and a check that quietly asserted nothing would pass
// a build whose opening wave is empty — so the roster is hard-asserted to hold one
// before any speed is read. How many there should be is
// `waves/wave-one-spawns-four`'s item.

import { afterEach, beforeEach, it } from "vitest";
import {
  ROCK_SPEED_MAX,
  ROCK_SPEED_MIN,
  TICK_DT,
  WAVE_MIN_STAR_DIST,
  WAVE_SPEED_CAP,
  WAVE_SPEED_STEP,
} from "../../src/constants";
import { assertBetween, assertGreaterThanOrEqual, fail } from "../assert";
import { gravityMagnitude, speedOf } from "../geometry";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import { STAR, rocksOfSize, startGameFromTitle } from "./scene";

/** How far outside the scaled range a reading may sit: two percent, the item's figure. */
const TOLERANCE = 0.02;

/**
 * The speed multiplier `specs/progression.md` gives wave `n`'s rocks.
 *
 * The specification's own formula, written here rather than read off the build, so
 * the window a reading is held to is the one the case states.
 */
function waveSpeedScale(wave: number): number {
  return 1 + Math.min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (wave - 1));
}

/**
 * What the well may have added to a fresh rock before the reading, in units per
 * second.
 *
 * One tick of `specs/gravity.md`'s pull at the closest a wave may place a rock to
 * the star, `WAVE_MIN_STAR_DIST` (`200`). It is the environment's contribution to a
 * number the check reads a tick after it was written, not room on the
 * specification's figure.
 */
const WELL_SLACK =
  gravityMagnitude({ x: STAR.x + WAVE_MIN_STAR_DIST, y: STAR.y }) * TICK_DT;

/** How long the opening wave is waited for: past a full `WAVE_BANNER_TIME` and more. */
const OPENING_TICKS = ticksFor(4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spawns every Large of a wave inside its base drift speed range", async () => {
  await startGameFromTitle(h);

  const opened = await h.until((snapshot) => snapshot.rocks.length > 0, {
    maxFrames: OPENING_TICKS,
    poll: 1,
  });
  captureStill(h, "wave");
  if (!opened.hit) {
    fail(
      "a game whose opening wave puts rocks on the field within four seconds " +
        "(specs/progression.md)",
      "the rock roster was still empty",
    );
  }

  const scale = waveSpeedScale(opened.snapshot.wave);
  const larges = rocksOfSize(opened.snapshot, "large");

  assertGreaterThanOrEqual(
    larges.length,
    1,
    `Large rocks on the field when wave ${opened.snapshot.wave} arrived (specs/progression.md)`,
  );

  for (const [index, rock] of larges.entries()) {
    assertBetween(
      speedOf(rock),
      ROCK_SPEED_MIN.large * scale * (1 - TOLERANCE) - WELL_SLACK,
      ROCK_SPEED_MAX.large * scale * (1 + TOLERANCE) + WELL_SLACK,
      `Large ${index + 1} of ${larges.length}: the drift speed wave ${opened.snapshot.wave} spawned it at (specs/rocks.md, specs/progression.md)`,
    );
  }
});
