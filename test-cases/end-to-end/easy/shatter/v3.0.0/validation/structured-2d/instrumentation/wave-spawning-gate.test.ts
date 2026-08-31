// instrumentation/wave-spawning-gate — with `setWaveSpawning(false)` a field
// emptied by shooting stays empty; with it on, the same field turns over.
//
// THE RULE. `specs/instrumentation.md`, The world gates: "`setWaveSpawning
// (enabled)` gates the game's own wave loop: noticing that the last rock has
// been destroyed, raising the `WAVE N` banner, advancing the wave number, and
// spawning the wave the banner announces. Off, an emptied field stays empty and
// the wave number holds."
//
// THE FIELD IS EMPTIED BY SHOOTING, and that is the whole design of this check.
// `specs/progression.md`: "A wave clears on the tick in which the last rock on
// the field is destroyed. It is a transition, not a condition on the field: a
// field that holds no rocks and has had none destroyed on that tick is a wave
// being played, not a wave cleared." And `specs/instrumentation.md` says of
// `clearRocks()` that "it destroys nothing and scores nothing". So a check that
// emptied the field with `clearRocks` would be posing a scenario the gate has
// nothing to do with, and would pass a build whose wave loop is missing
// entirely. The round below goes in through `addBullet` and is resolved by the
// build's own collision, split and scoring code.
//
// ONE SMALL ROCK IS THE WHOLE FIELD. `specs/rocks.md` breaks a Large into two
// Mediums and a Medium into two Smalls, so only destroying a Small takes a rock
// off the field — a Small is therefore the shortest honest route to "the last
// rock on the field is destroyed", and it puts nothing on the field the
// requirement is not about.
//
// THE ROUND IS PLACED ON THE ROCK'S DOORSTEP, on the side facing AWAY from the
// star and carrying the rock's own velocity (`aimedRound`), so its whole flight
// is the standoff: it cannot be absorbed by the core on a miss
// (`specs/collision.md`) and the well has no stretch over which to bend it.
//
// THE SAUCER GATE STAYS SHUT throughout. This item is about one faculty, and a
// saucer wandering in at eighteen seconds would put an enemy on a field the
// check is holding empty.

import { afterEach, beforeEach, it } from "vitest";
import { BULLET_LIFE, WAVE_BANNER_TIME } from "../../src/constants";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { QUIET_CORNER } from "../fixtures";
import {
  aimedRound,
  captureStill,
  createHarness,
  poseBullet,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The wave the field is posed on, so the turn-over is a reading of `1` -> `2`. */
const POSED_WAVE = 1;

/** How long the emptied field is watched for, in seconds of game time. */
const QUIET_SECONDS = 10;

/** How often that watch samples, in frames. A banner runs for 1.5 s (180). */
const QUIET_POLL = 4;

/**
 * How long a placed round is followed before it is called a miss, in frames.
 *
 * A round on a rock's doorstep lands within a tick or two; waiting the whole of
 * `BULLET_LIFE` (`specs/weapons.md`) costs nothing in the ordinary case and is
 * what turns a build whose rounds pass through rocks into a named failure.
 */
const ROUND_FRAMES = ticksFor(BULLET_LIFE) + 2;

/** How long the banner is given to run down and spawn, in frames. */
const BANNER_FRAMES = ticksFor(WAVE_BANNER_TIME) + ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Pose one Small on the quiet ground and shoot it down for real. */
async function emptyTheFieldByShooting(): Promise<void> {
  const id = poseRock(h, "small", QUIET_CORNER.x, QUIET_CORNER.y);
  const target = requireRock(h.snapshot(), id, "the posed Small");
  const round = aimedRound(target);
  poseBullet(h, round.x, round.y, round.vx, round.vy);

  const down = await h.until((s) => s.rocks.length === 0, {
    maxFrames: ROUND_FRAMES,
  });
  assertEqual(
    down.hit,
    true,
    "a round placed on a Small's doorstep destroys it, taking the last rock " +
      "off the field (specs/collision.md)",
  );
}

it("off, an emptied field stays empty, raises no banner and holds the wave", async () => {
  startPlaying(h);
  h.debug.setWaveSpawning(false);
  h.debug.setWave(POSED_WAVE);

  await emptyTheFieldByShooting();
  assertEqual(h.snapshot().waveSpawning, false, "the gate is off");

  const stirred = await h.until(
    (s) => s.rocks.length > 0 || s.waveBanner > 0 || s.wave !== POSED_WAVE,
    { maxFrames: ticksFor(QUIET_SECONDS), poll: QUIET_POLL },
  );

  // The emptied field still empty ten seconds on.
  captureStill(h, "quiet");

  assertEqual(
    stirred.hit,
    false,
    `with waveSpawning off, ${QUIET_SECONDS} s of game time after the last ` +
      "rock was destroyed raise no banner, advance no wave and spawn no rock",
  );
  const after = h.snapshot();
  assertLength(after.rocks, 0, "the field is still empty");
  assertEqual(after.waveBanner, 0, "no banner is showing");
  assertEqual(after.wave, POSED_WAVE, "the wave number holds");
});

it("on, the same field turns over: the wave advances, the banner runs, rocks arrive", async () => {
  startPlaying(h);
  h.debug.setWaveSpawning(true);
  h.debug.setWave(POSED_WAVE);

  await emptyTheFieldByShooting();

  // On the tick the last rock is destroyed the wave advances and the banner it
  // announces goes up (specs/progression.md).
  const cleared = h.snapshot();
  assertEqual(cleared.wave, POSED_WAVE + 1, "the wave number advances by one");
  assertGreaterThan(cleared.waveBanner, 0, "the WAVE N banner is raised");

  // And the wave the banner announces is spawned as it ends.
  const arrived = await h.until((s) => s.rocks.length > 0, {
    maxFrames: BANNER_FRAMES,
  });
  assertEqual(
    arrived.hit,
    true,
    "with waveSpawning on, the wave the banner announced is put on the field",
  );
});
