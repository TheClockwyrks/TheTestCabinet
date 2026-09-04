// audio/kill — the cue a matching shot plays when it destroys a drone.
//
// `specs/ui.md` fixes `CUES.kill` (`"kill"`) as the cue played when "a matching
// shot destroys a drone or a Prism's layer", and governs all nine with one
// sentence: "Each is played on the frame its event happens and at most once on
// that frame."
//
// So the measurement is: pose an empty, quiet, live wave holding ONE Shard, send
// one of the player's bullets of the SAME band up into it, step one frame at a
// time, and read what the bus announced on the frame the drone left the roster
// against what it announced over the bullet's climb. The climb is the half a build
// cannot fake — a build that blips every frame sounds on the kill's frame too, and
// fails on the quiet that should have come first.
//
// THE KILL IS REAL, NOT POSED. Nothing here removes the drone: a bullet is placed
// below it carrying the band `specs/bands.md` says destroys, and the build's own
// contact and band rules decide the rest. The Shard is posed as a PROP, with all
// three faculties off, so it neither travels, oscillates nor fires while the shot
// is in the air.
//
// WHAT THIS DOES NOT DECIDE. That a matching shot destroys, what it scores, or
// what it pops, which are `bands/match-destroys`'s, `scoring/*`'s and
// `bursts/spawns-on-kill`'s; nor that a stage clear sounds, which is
// `audio/stage-clear`'s.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, PLAYER_BULLET_SPEED } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  droneOf,
  findDrone,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import {
  cuesBeforeEvent,
  cuesOnEvent,
  gainOnEvent,
  poseShotBelow,
  quietFrames,
  watchForEvent,
} from "./cues";

/**
 * Where the target Shard stands: inside the play field, clear of the ship's lane
 * at `LANE_CENTER` (`640`), with room under it for the shot's climb.
 */
const TARGET_X = 400;
const TARGET_Y = 300;

/**
 * How far below the drone the bullet starts, in logical units.
 *
 * Far enough that the climb is a real window of quiet — at `PLAYER_BULLET_SPEED`
 * (`760`) it is better than a quarter of a second — and short enough that the
 * bullet is still well inside the play field when it is placed.
 */
const SHOT_BELOW = 200;

/**
 * Frames the climb is given to reach the drone.
 *
 * The time to climb the whole `SHOT_BELOW` at `PLAYER_BULLET_SPEED` — geometry,
 * not a tolerance — plus two frames for the frame the bullet is placed on. Contact
 * lands sooner, since the drone's and the bullet's half-extents meet before their
 * centres do.
 */
const CLIMB_FRAMES = ticksFor(SHOT_BELOW / PLAYER_BULLET_SPEED) + 2;

/** Frames run after the reading, purely so the still shows the pop it left. */
const TAIL_FRAMES = ticksFor(0.1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.kill on the frame a matching shot destroys a drone, and not before", async () => {
  // An empty, quiet, live wave, then exactly the one drone the requirement is
  // about, posed as a prop: no travel, no oscillation, no fire.
  startPosed(h);
  const targetId = poseDrone(h, "shard", TARGET_X, TARGET_Y, { band: "cyan" });
  const target = droneOf(h.snapshot(), targetId);
  poseShotBelow(h, target.x, target.y, target.effectiveBand, SHOT_BELOW);

  const watch = await watchForEvent(
    h,
    (s) => findDrone(s, targetId) === null,
    CLIMB_FRAMES,
  );
  // Held on past the reading, so the still shows the burst the kill left rather
  // than the frame the drone vanished on. Nothing after this line can reach an
  // assertion.
  await h.advance(TAIL_FRAMES);
  captureStill(h, "kill");

  assertEqual(
    watch.hit,
    true,
    `the ${target.effectiveBand} shot placed ${String(SHOT_BELOW)} units below ` +
      `the drone destroyed it inside the ${String(CLIMB_FRAMES)} frames its ` +
      "climb takes (specs/bands.md)",
  );
  assertEqual(
    cuesBeforeEvent(watch, CUES.kill),
    0,
    `times CUES.kill played over the ${String(quietFrames(watch))} frames the ` +
      "bullet climbed, on a field where nothing else is happening — a cue is " +
      "played on the frame its event happens (specs/ui.md)",
  );
  assertEqual(
    cuesOnEvent(watch, CUES.kill),
    1,
    "times CUES.kill played on the frame the matching shot destroyed the drone, " +
      "which is its own frame and at most once on it (specs/ui.md)",
  );
  assertGreaterThan(
    gainOnEvent(watch, CUES.kill),
    0,
    "the gain the bus announced the kill cue at, nothing here having muted it — " +
      "each of the nine is a distinct short sound a player hears (specs/ui.md)",
  );
});
