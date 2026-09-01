// Spectra — screens/challenge-hit-count: an imperfect challenge stage reports its
// count.
//
// THE RULE. `specs/ui.md`, on what `stageCleared` reports: after "A challenge stage in
// which a drone survived" it draws "The count of drones destroyed" — rather than the
// `PERFECT_TEXT` a flyover taken whole earns, which is
// `screens/challenge-perfect-result`'s point.
//
// WHY THIS ONE IS PLAYED RATHER THAN POSED. The count is a latch the run keeps, and
// `specs/instrumentation.md` gives the surface no operation that sets it — `reset`
// returns it to its opening value and nothing else touches it. So there is no pose
// that reaches "one was destroyed and the rest got away": the stage has to be flown
// and one of its drones really destroyed.
//
// THE COUNT IS ONE, AND THAT IS THE DISTINGUISHING VALUE. Exactly one drone is taken,
// out of `CHALLENGE_TOTAL` (`40`), so the number the screen must draw is `1` — a
// number nothing else on that screen carries. The score is `SCORE_CHALLENGE_DRONE`
// (`100`), the stage is `3`, the lives are `START_LIVES` (`3`) and the meter reads
// what one kill filled it to, so a build drawing the TOTAL, the count of survivors,
// the stage, or a hard-coded number all read as something other than `1`. The other
// thirty-nine are simply left to sweep off the field, which `specs/stages.md` gives
// them eight seconds from their group's release to do.
//
// THE SHOT IS A REAL ONE, TAKEN EARLY AND CLOSE. A challenge drone is destroyed like
// any other: `specs/bands.md` destroys a drone whose effective band the bullet's
// matches, so the target's own `effectiveBand` is read off the snapshot and a bullet
// carrying it is placed `SHOT_BELOW` under it. Close, because the drone is sweeping
// along a path of the build's design and the shot has to arrive before it has moved
// out from under itself; early, because a drone that has just entered the field cannot
// yet be leaving it, which is what makes "the target left the roster" mean "the shot
// destroyed it".
//
// A MISS COSTS NOTHING, WHICH IS WHY IT RETRIES. A matching shot that reaches nothing
// destroys nothing (`specs/bands.md`), so a shot that misses a sweeping drone leaves
// the field exactly as it found it and another can be taken. The player's roster is
// emptied before each shot and once the loop is done, so a shot still climbing can
// never take a second drone later: what is counted is exactly the ids one arriving
// bullet removed.
//
// NO CHALLENGE DRONE IS A FLUX OR A PRISM, so one shot is one drone.
// `specs/stages.md`: "A flyover carries no drone that oscillates between the bands and
// none that wears two layers at once", so there is no shimmer window to miss through
// and no shell to break instead of the drone.
//
// WHAT IS NOT ASSERTED. How long the screen holds, which is
// `screens/stage-cleared-hold`'s; what a challenge kill PAYS, which is the `scoring`
// group's; what the screen says when nothing survived, which is
// `screens/challenge-perfect-result`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  CHALLENGE_TOTAL,
  FIELD_TOP,
  PLAYER_BULLET_SPEED,
  SHARD_SIZE,
  isChallengeStage,
} from "../../src/constants";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  fireAt,
  seconds,
  startStage,
  ticksFor,
  type Harness,
} from "../harness";
import { drawFrame, drewNumber } from "./reading";

/** The stage flown: the first challenge stage (specs/stages.md). */
const CHALLENGE_STAGE = 3;

/** How many of the stage's drones this scenario destroys. */
const DESTROYED = 1;

/**
 * How far below the target the shot starts, in logical units.
 *
 * Close, so the bullet's climb at `PLAYER_BULLET_SPEED` (`760`) takes about five
 * hundredths of a second and the drone cannot have swept out from over it — the path a
 * flyover takes is the build's own and nothing here may assume a speed along it. Far
 * enough that the bullet starts clear of the drone's own footprint — the largest a
 * flyover carries is a Shard, `SHARD_SIZE` (`28`) across — and the contact is one the
 * build's rules resolve rather than an overlap posed on top of it.
 */
const SHOT_BELOW = 40;

/**
 * Frames the flight is allowed.
 *
 * Enough for the shot to climb `SHOT_BELOW` plus a whole Shard's footprint at
 * `PLAYER_BULLET_SPEED`, so by the last frame the contact has had every chance to
 * resolve, plus two frames of slack for a build that resolves contacts at the end of
 * its own sub-step loop.
 */
const FLIGHT_TICKS =
  ticksFor((SHOT_BELOW + SHARD_SIZE) / PLAYER_BULLET_SPEED) + 2;

/**
 * How far into the play field a drone must have come before it is shot at.
 *
 * The shot starts `SHOT_BELOW` under the target, and `specs/field.md` removes a player
 * bullet "whose center climbs above `FIELD_TOP`" — so a target must be at least that
 * far below the top edge for its shot to exist at all. Twice over, so the bullet has
 * field to travel through rather than starting on the line.
 */
const TARGET_MIN_Y = FIELD_TOP + 2 * SHOT_BELOW;

/**
 * How many shots may be taken before the scenario gives up.
 *
 * A miss destroys nothing and leaves the field as it found it, so each is free; the
 * bound is what stops a build whose drones cannot be hit at all from spinning. A bound
 * on the scenario rather than a threshold on the build.
 */
const MAX_SHOTS = 12;

/** How long a drone is waited for, and how long the flyover is given to finish. */
const MAX_ARRIVAL_FRAMES = ticksFor(6);
const MAX_SETTLE_FRAMES = ticksFor(25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the count of drones destroyed after a challenge stage one survived", async () => {
  await startStage(h, CHALLENGE_STAGE);
  const opened = h.snapshot();
  assertEqual(opened.screen, "inWave", "the stage's live wave is open");
  assertEqual(
    opened.isChallenge,
    isChallengeStage(CHALLENGE_STAGE),
    `stage ${String(CHALLENGE_STAGE)} is a challenge stage (specs/stages.md)`,
  );

  // The first of the flyover's drones to come far enough into the field to be shot at
  // from below.
  const arrived = await h.until(
    (s) => s.drones.some((drone) => drone.y >= TARGET_MIN_Y),
    { maxFrames: MAX_ARRIVAL_FRAMES, poll: 1 },
  );
  assertTrue(
    arrived.hit,
    `a challenge drone coming at least ${String(TARGET_MIN_Y - FIELD_TOP)} ` +
      "units into the play field, which a group sweeping across it does " +
      "(specs/stages.md)",
  );

  let destroyed = 0;
  for (let shot = 0; shot < MAX_SHOTS && destroyed === 0; shot += 1) {
    h.debug.clearPlayerBullets();
    const before = h.snapshot();
    const target = before.drones.find((drone) => drone.y >= TARGET_MIN_Y);
    if (target === undefined) continue;
    await fireAt(
      h,
      target.x,
      target.y,
      target.effectiveBand,
      SHOT_BELOW,
      FLIGHT_TICKS,
    );
    const standing = new Set(h.snapshot().drones.map((drone) => drone.id));
    destroyed = before.drones.filter((drone) => !standing.has(drone.id)).length;
  }
  // Nothing of the scenario's is left in flight to take a second drone.
  h.debug.clearPlayerBullets();

  assertEqual(
    destroyed,
    DESTROYED,
    "drones taken off the field by the scenario's shots — exactly " +
      `${String(DESTROYED)} is what makes the count this screen must report a ` +
      "number nothing else on it carries",
  );
  assertGreaterThan(
    h.snapshot().drones.length,
    0,
    "precondition: drones of the flyover are still on the field, so this is a " +
      "challenge stage a drone SURVIVED (specs/ui.md)",
  );

  // The rest of the flyover sweeps off the field on its own.
  const finished = await h.until((s) => s.screen === "stageCleared", {
    maxFrames: MAX_SETTLE_FRAMES,
    poll: 1,
  });
  assertTrue(
    finished.hit,
    "the challenge stage finishing inside " +
      `${String(seconds(MAX_SETTLE_FRAMES))} seconds and opening the ` +
      "stage-cleared interstitial — each group leaves the field within eight " +
      "seconds of its release, and the stage ends when the last of its drones " +
      "has left or been destroyed (specs/stages.md); the game was on " +
      `${finished.snapshot.screen} with ` +
      `${String(finished.snapshot.drones.length)} drones still on the field`,
  );

  const calls = await drawFrame(h);
  captureStill(h, "count");

  assertTrue(
    drewNumber(calls, DESTROYED),
    "the stage-cleared screen drawing the count of drones destroyed " +
      `(${String(DESTROYED)} of CHALLENGE_TOTAL ${String(CHALLENGE_TOTAL)}) ` +
      "after a challenge stage in which a drone survived (specs/ui.md)",
  );
});
