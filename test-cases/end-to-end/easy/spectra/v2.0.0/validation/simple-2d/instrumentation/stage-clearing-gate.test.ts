// instrumentation/stage-clearing-gate — with the live stage's own end-of-stage
// test gated off, destroying the wave's last drone leaves the wave live; with it
// on, the same scenario ends it.
//
// specs/instrumentation.md gives the gate exactly one faculty:
// `setStageClearing(enabled)` gates "The live stage's own end-of-stage test, which
// is the rule `specs/stages.md` states for a standard stage clearing and for a
// challenge stage ending. Off, no stage clears or ends however the field empties,
// and nothing else changes: drones are still destroyed, still scored, and still
// burst as usual."
//
// WITHOUT IT, MOST OF THIS PROJECT IS MIS-POSED. `specs/stages.md` clears a
// standard stage in the moment the last drone of its wave is destroyed, so a
// scenario that poses one drone and destroys it — which is what nearly every
// scoring, band, burst and resonance point does — can end the stage on that same
// frame: the screen leaves `inWave`, the field stops resolving contacts, and
// `SCORE_STAGE_CLEAR` (`1000`) lands in the score the check was about to read.
// `startPosed` shuts this gate for exactly that reason, and this is where it is
// decided.
//
// WHY THE GAME'S OWN WAVE, RAKED DOWN. The rule the gate governs is stated over
// "the last drone of its wave", and the specification leaves a build free to read
// "its wave" either way — the drones the stage itself built, or the drones on the
// field. `rakeToLastDrone` opens stage 1's own wave and removes every drone but
// one of its own Shards, which is the one scenario where the two readings agree,
// so neither half below rests on which reading the build took. It is the same
// route `stages/clears-on-last-drone` stands on.
//
// BOTH DIRECTIONS ARE READ, ON THE SAME SCENARIO. With the gate shut the kill
// must leave the wave live and pay only what the kill pays; with it standing as
// the specification leaves it — on — the same kill must end the wave. One half
// alone would pass a build that never clears a stage at all, or one that never
// keeps a wave open.
//
// THE KILL IS REAL, NOT POSED. Nothing here removes the survivor: one of the
// player's bullets is put under it on its own band, and the build's own contact,
// band and stage rules decide the rest. That matters because the rule the gate
// governs is stated over a drone being DESTROYED.
//
// WHAT THIS DOES NOT DECIDE. The clear rule itself, which is
// `stages/clears-on-last-drone`'s and `stages/empty-wave-does-not-clear`'s; which
// screen a clear opens, which is `screens/stage-cleared-hold`'s; and what a clear
// pays, which is `scoring/stage-clear-bonus`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotEqual,
  assertTrue,
} from "../assert";
import { PLAYER_BULLET_SPEED, SCORE_STAGE_CLEAR } from "../constants";
import {
  captureStill,
  createHarness,
  findDrone,
  ticksFor,
  type Harness,
} from "../harness";
import { rakeToLastDrone, SURVIVOR_AT } from "../stages/rake";

/** How far below the survivor the shot starts. Clear of it, and inside the field. */
const SHOT_BELOW = 200;

/**
 * Frames the shot is given to resolve.
 *
 * The geometry alone — the frames a bullet needs to climb `SHOT_BELOW` at
 * `PLAYER_BULLET_SPEED` — plus four frames of slack for where inside a frame the
 * contact falls. Nothing about either verdict rests on it: a bullet that has not
 * resolved by then has missed a stationary target it was fired straight at.
 */
const SHOT_FRAMES = ticksFor(SHOT_BELOW / PLAYER_BULLET_SPEED) + 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the wave live when its last drone dies with the gate off", async () => {
  const survivor = await rakeToLastDrone(h);
  h.debug.setStageClearing(false);

  const before = h.snapshot();
  assertEqual(
    before.stageClearing,
    false,
    "precondition: snapshot().stageClearing after setStageClearing(false)",
  );
  assertLength(
    before.drones,
    1,
    "precondition: the one drone of the game's own wave the rake left standing",
  );
  assertEqual(
    before.screen,
    "inWave",
    "precondition: the live wave, still playing while that drone stands",
  );
  const scoreBefore = before.score;

  h.debug.addPlayerBullet(
    SURVIVOR_AT.x,
    SURVIVOR_AT.y + SHOT_BELOW,
    survivor.band,
  );
  const killed = await h.until(
    (snapshot) => findDrone(snapshot, survivor.id) === null,
    { maxFrames: SHOT_FRAMES, poll: 1 },
  );
  captureStill(h, "carrying-on");

  assertTrue(
    killed.hit,
    "precondition: a matching shot to destroy the wave's last drone " +
      "(specs/bands.md)",
  );
  assertEqual(
    killed.snapshot.screen,
    "inWave",
    "the screen after the wave's last drone was destroyed with " +
      "setStageClearing(false) held — no stage clears however the field " +
      "empties (specs/instrumentation.md)",
  );
  assertEqual(
    killed.snapshot.phase,
    "live",
    "the phase after that kill, which is a wave still being played " +
      "(specs/instrumentation.md)",
  );
  assertTrue(
    killed.snapshot.score - scoreBefore < SCORE_STAGE_CLEAR,
    `the score to have risen by less than SCORE_STAGE_CLEAR ` +
      `(${String(SCORE_STAGE_CLEAR)}) over that kill — the gate held the ` +
      "clear off, so the kill's own figure is all that was paid " +
      "(specs/instrumentation.md)",
  );
});

it("ends the wave on the same scenario with the gate as reset leaves it", async () => {
  // The same route, differing in the gate alone: `rakeToLastDrone` leaves
  // `stageClearing` exactly as the specification does, on. Without this half a
  // build that never clears a stage at all would pass the check above.
  const survivor = await rakeToLastDrone(h);

  const before = h.snapshot();
  assertEqual(
    before.stageClearing,
    true,
    "precondition: snapshot().stageClearing, which reset restores to on",
  );
  assertLength(
    before.drones,
    1,
    "precondition: the one drone of the game's own wave the rake left standing",
  );

  h.debug.addPlayerBullet(
    SURVIVOR_AT.x,
    SURVIVOR_AT.y + SHOT_BELOW,
    survivor.band,
  );
  const killed = await h.until(
    (snapshot) => findDrone(snapshot, survivor.id) === null,
    { maxFrames: SHOT_FRAMES, poll: 1 },
  );

  assertTrue(
    killed.hit,
    "precondition: a matching shot to destroy the wave's last drone " +
      "(specs/bands.md)",
  );
  assertNotEqual(
    killed.snapshot.screen,
    "inWave",
    "the wave to have ended in the frame its last drone was destroyed, with " +
      "the gate standing as the specification leaves it (specs/stages.md)",
  );
});
