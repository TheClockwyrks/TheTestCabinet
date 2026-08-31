// instrumentation/wave-spawning-gate — `setWaveSpawning(false)` really does shut
// the game's own wave loop: a field emptied by shooting raises no banner, advances
// no wave and spawns no rock. With the gate open, the same field turns over.
//
// WHY THE FIELD IS EMPTIED BY SHOOTING RATHER THAN BY CLEARING IT. This is the
// distinction `specs/progression.md` draws and `specs/instrumentation.md` restates:
// "A wave clears on the tick in which the last rock on the field is destroyed. It
// is a transition, not a condition on the field", and `clearRocks` "destroys
// nothing and scores nothing, so a field it emptied has had no rock destroyed on
// that tick". A check that reached its empty field with `clearRocks` and then
// asserted that no wave arrived would pass a build with no gate at all, and would
// FAIL a perfectly conformant build that raises its next wave from the destruction
// event rather than from polling the field. So the rock here is shot down: one
// round on its doorstep, through the build's own collision and split rules.
//
// AND IT IS A SMALL. `specs/rocks.md` has a Large leave two Mediums and a Medium
// leave two Smalls, so only destroying a Small takes a rock off the field at all.
// A Small is the one rock whose destruction can be the LAST destruction.
//
// THE GATE IS DECIDED IN BOTH DIRECTIONS, over the same scenario twice. Shut, ten
// seconds of game time — nearly seven times the banner `specs/progression.md` runs
// — leave the field exactly as the kill left it. Open, the same kill turns the wave
// over. A build with no gate at all fails the first leg; a build whose gate is
// stuck shut fails the second.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import { WAVE_BANNER_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  destroyRock,
  poseRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The wave the run is posed at, so an advance is visible as a change. */
const WAVE = 3;

/** Where the rock stands: 412 units from the star, well clear of the ship. */
const ROCK_PLACE = { x: 320, y: 620 } as const;

/** The game time an emptied field is watched for, in seconds. */
const QUIET_TIME = 10;

/** How often the quiet stretch is sampled, in ticks: a tenth of a second. */
const QUIET_POLL = ticksFor(0.1);

/**
 * How long the wave number is given to advance after the last rock is destroyed.
 *
 * A quarter of a second. `specs/progression.md` puts the advance on the tick the
 * wave clears; this leaves room for a build that runs its wave loop at the end of
 * the tick that destroyed the rock, or on the one after, without leaving room for
 * a build that advances the wave for some other reason entirely.
 */
const TURNOVER_TICKS = ticksFor(0.25);

/** How long the rocks the banner announces are given to arrive, in ticks. */
const SPAWN_TICKS = ticksFor(WAVE_BANNER_TIME + 0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a field emptied by shooting empty while the gate is shut", async () => {
  // `startPlaying` opens with the wave gate shut, which is the state under test.
  await startPlaying(h, { wave: WAVE });
  const id = await poseRock(h, "small", ROCK_PLACE.x, ROCK_PLACE.y);
  const killed = await destroyRock(h, id);
  assertLength(
    killed.result.snapshot.rocks,
    0,
    "the field the last Small's destruction left",
  );

  const stirred = await h.skipUntil(
    (s) => s.rocks.length > 0 || s.waveBanner > 0 || s.wave !== WAVE,
    { maxTicks: ticksFor(QUIET_TIME), poll: QUIET_POLL },
  );
  await captureStill(h, "quiet");

  assertTrue(
    !stirred.hit,
    `nothing stirred over ${QUIET_TIME}s of game time with setWaveSpawning(false)`,
  );
  const quiet = await h.snapshot();
  assertLength(quiet.rocks, 0, `the rocks ${QUIET_TIME}s on`);
  assertEqual(quiet.waveBanner, 0, `the banner ${QUIET_TIME}s on`);
  assertEqual(quiet.wave, WAVE, `the wave number ${QUIET_TIME}s on`);
});

it("turns the same field over once the gate is open", async () => {
  await startPlaying(h, { wave: WAVE });
  await h.debug.setWaveSpawning(true);
  const id = await poseRock(h, "small", ROCK_PLACE.x, ROCK_PLACE.y);
  await destroyRock(h, id);

  const turned = await h.until((s) => s.wave === WAVE + 1, {
    maxTicks: TURNOVER_TICKS,
    poll: 1,
  });
  assertTrue(
    turned.hit,
    `the wave advanced to ${WAVE + 1} when the last rock was destroyed`,
  );
  assertGreaterThan(
    turned.snapshot.waveBanner,
    0,
    "the WAVE N banner the clear raised",
  );

  const spawned = await h.skipUntil((s) => s.rocks.length > 0, {
    maxTicks: SPAWN_TICKS,
    poll: QUIET_POLL,
  });
  assertTrue(spawned.hit, "the wave the banner announced arrived");
});
