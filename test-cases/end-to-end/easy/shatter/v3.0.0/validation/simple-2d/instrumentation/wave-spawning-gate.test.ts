// instrumentation/wave-spawning-gate — `setWaveSpawning(false)` shuts the game's
// own wave loop, so a field emptied by shooting stays empty; with the gate on, the
// same field turns over.
//
// WHAT THE GATE IS FOR. `specs/instrumentation.md` gives it four jobs at once —
// "noticing that the last rock has been destroyed, raising the `WAVE N` banner,
// advancing the wave number, and spawning the wave the banner announces" — and
// says that off, "an emptied field stays empty and the wave number holds". Almost
// every scenario in this project runs behind it: without it a build is entitled to
// drop five Large rocks into any check that runs for more than a moment, and a
// gravity or flight reading taken on a field a wave has just landed on is a
// reading of somebody else's rock. So a gate that does nothing quietly poisons the
// suite, and this is the item that names it.
//
// THE FIELD IS EMPTIED BY SHOOTING, NOT BY `clearRocks`. `specs/progression.md`
// clears a wave "on the tick in which the last rock on the field is destroyed" and
// calls it "a transition, not a condition on the field"; `specs/instrumentation.md`
// says `clearRocks` "destroys nothing and scores nothing, so a field it emptied has
// had no rock destroyed on that tick". A check that reached an emptied field by
// calling `clearRocks` would therefore be grading the debug operation rather than
// the game, and would fail every conformant build that raises its next wave from
// the destruction event instead of by polling whether the field is empty. So the
// rock here is shot down for real, by a round placed on its doorstep and carried in
// by the build's own collision code, and the gate is read across a genuine
// wave-clearing transition.
//
// ONE SMALL ROCK, BECAUSE A SMALL IS THE ONLY ROCK WHOSE DESTRUCTION EMPTIES A
// FIELD. `specs/rocks.md` breaks a Large into two Mediums and a Medium into two
// Smalls, so shooting anything larger leaves more rocks than it took away. One
// Small, one round, one transition.
//
// AND THE TWO LEGS ARE THE SAME SCENARIO TWICE, differing only in the gate: the
// same rock, in the same place, shot the same way. A build whose gate does nothing
// fails the OFF leg; one whose gate is inverted fails both; one with no wave loop
// at all fails the ON leg.

import { afterEach, beforeEach, it } from "vitest";
import { WAVE_BANNER_TIME } from "../../src/constants";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  shootRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the one Small stands: a corner 483 units out, where the well is gentle. */
const ROCK_PLACE = { x: 200, y: 160 } as const;

/** The wave the run is opened on, and the one it must reach when it turns over. */
const OPENING_WAVE = 1;
const NEXT_WAVE = OPENING_WAVE + 1;

/** How long an emptied field is watched for a wave that must never come. */
const QUIET_FRAMES = ticksFor(10);

/**
 * How long the next wave's rocks are given to arrive, in ticks.
 *
 * The banner `specs/progression.md` fixes (`WAVE_BANNER_TIME`, 1.5 seconds), plus
 * half a second of slack so a build that raises the banner on the tick after the
 * clear is not cut off by the ceiling. It bounds a build that never spawns rather
 * than fixing a schedule.
 */
const ARRIVAL_FRAMES = ticksFor(WAVE_BANNER_TIME + 0.5);

/** The decimal places the banner is read to: exactly, since `0` means none. */
const BANNER_DIGITS = 6;

let h: Harness;

/**
 * Open a quiet run at wave 1 holding one Small, set the wave gate, and shoot the
 * rock down for real.
 *
 * Nothing else is on the field: no bullet of the ship's own beyond the round, no
 * saucer, no enemy fire, and the ship's contact gate shut, so the only transition
 * the game can make is the one the gate is about.
 */
async function emptyTheField(gate: boolean): Promise<void> {
  startPlaying(h);
  h.debug.setWaveSpawning(gate);
  const id = poseRock(h, "small", ROCK_PLACE.x, ROCK_PLACE.y);
  const shot = await shootRock(h, id);
  assertTrue(
    shot.destroyed,
    "the round destroyed the Small it was placed on the doorstep of " +
      "(specs/collision.md)",
  );
  assertLength(h.snapshot().rocks, 0, "the field the last destruction left");
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves an emptied field empty with the gate off, and turns it over with the gate on", async () => {
  // ---- The gate shut ------------------------------------------------------
  await emptyTheField(false);

  // Ten seconds of game time in which nothing may stir. The sweep stops at the
  // first sign of one, so the reading below is taken at the moment a build broke
  // the rule rather than at the end of the window, and names which of the four
  // jobs the gate failed to hold.
  const quiet = await h.until(
    (s) => s.rocks.length > 0 || s.waveBanner > 0 || s.wave !== OPENING_WAVE,
    { maxFrames: QUIET_FRAMES, poll: 1 },
  );
  captureStill(h, "quiet");
  assertLength(
    quiet.snapshot.rocks,
    0,
    "the rocks a field emptied under setWaveSpawning(false) spawned",
  );
  assertCloseTo(
    quiet.snapshot.waveBanner,
    0,
    BANNER_DIGITS,
    "the banner a field emptied under setWaveSpawning(false) raised",
  );
  assertEqual(
    quiet.snapshot.wave,
    OPENING_WAVE,
    "the wave a field emptied under setWaveSpawning(false) advanced to",
  );

  // ---- And the same field with the gate open ------------------------------
  await emptyTheField(true);

  // The banner and the wave number are read on the destruction itself, which is
  // the tick `specs/progression.md` says the wave clears on.
  const cleared = h.snapshot();
  assertGreaterThan(
    cleared.waveBanner,
    0,
    "the WAVE N banner the clearing raised, in seconds (specs/progression.md)",
  );
  assertEqual(
    cleared.wave,
    NEXT_WAVE,
    "the wave the clearing advanced to (specs/progression.md)",
  );

  // And the rocks the banner announced arrive as it ends.
  const arrived = await h.until((s) => s.rocks.length > 0, {
    maxFrames: ARRIVAL_FRAMES,
    poll: 1,
  });
  assertTrue(
    arrived.hit,
    `wave ${NEXT_WAVE} put its rocks up as the banner ended ` +
      "(specs/progression.md). How MANY it put up is " +
      "waves/wave-n-spawns-three-plus-n's to decide, so what is asked here is " +
      "that the field turned over at all",
  );
});
