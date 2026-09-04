// audio/kill — the cue a matching shot plays when it destroys a drone.
//
// `specs/ui.md` fixes `kill` as the cue played when "a matching shot destroys a
// drone or a Prism's layer", and governs all nine with one sentence: "Each is
// played on the frame its event happens and at most once on that frame."
//
// So the measurement is: pose an empty, quiet, live wave holding ONE Shard, send
// one of the player's bullets of the SAME band up into it, step one frame at a
// time, and read what sounded on the frame the drone left the roster against what
// sounded over the bullet's climb. The climb is the half a build cannot fake — a
// build that blips every frame sounds on the kill's frame too, and fails on the
// quiet that should have come first.
//
// THE KILL IS REAL, NOT POSED. Nothing here removes the drone: a bullet is placed
// below it carrying the band `specs/bands.md` says destroys, and the build's own
// contact and band rules decide the rest.
//
// A BYSTANDER STANDS OFF IN THE CORNER, and it is load-bearing. `specs/stages.md`
// clears a stage in the moment the last drone of its wave is destroyed, and a
// cleared stage plays the `stage-clear` cue on that same frame. A wave holding
// only the target would therefore raise TWO cues on the frame the target dies,
// and under this engine — where a cue's name is unobservable — the two could not
// be told apart. The bystander leaves a drone standing, so the frame this check
// reads carries the kill cue alone.
//
// WHAT THIS ENGINE CANNOT SEE. The cue's NAME, and how many sources one cue is
// made of. `./cues.ts` states why, and what these checks assert instead.
//
// WHAT THIS DOES NOT DECIDE. That a matching shot destroys, what it scores, or
// what it pops, which are `bands/match-destroys`'s, `scoring/*`'s and
// `bursts/spawns-on-kill`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { PLAYER_BULLET_SPEED } from "../constants";
import {
  captureStill,
  createHarness,
  droneById,
  framesFor,
  poseBystander,
  poseDrone,
  requireDrone,
  startPosed,
  type Harness,
} from "../harness";
import {
  poseShotBelow,
  quietFrames,
  soundsBeforeEvent,
  soundsOnEvent,
  watchForEvent,
} from "./cues";

/**
 * Where the target Shard stands: inside the play field, clear of the bystander's
 * corner and of the ship's lane, with room under it for the shot's climb.
 */
const TARGET_X = 400;
const TARGET_Y = 300;

/**
 * How far below the drone the bullet starts, in logical units.
 *
 * Far enough that the climb is a real window of quiet — at
 * `PLAYER_BULLET_SPEED` (`760`) it is a quarter of a second — and short enough
 * that the bullet is still well inside the play field when it is placed.
 */
const SHOT_BELOW = 200;

/**
 * Frames the climb is given to reach the drone.
 *
 * The time to climb the whole `SHOT_BELOW` at `PLAYER_BULLET_SPEED` — geometry,
 * not a tolerance — plus two frames for the frame the bullet is placed on.
 * Contact lands sooner, since the drone's and the bullet's half-extents meet
 * before their centres do.
 */
const CLIMB_FRAMES = framesFor(SHOT_BELOW / PLAYER_BULLET_SPEED) + 2;

/** Frames run after the reading, purely so the still shows the pop it left. */
const TAIL_FRAMES = framesFor(0.1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the frame a matching shot destroys a drone, and not before", async () => {
  // A real, browser-trusted gesture first: an engineless build owns its whole
  // audio layer and is entitled to open it on the player's first interaction
  // alone (`specs/ui.md`). The key is bound to nothing, so this changes no state.
  await h.armAudio();
  // An empty, quiet, live wave, then exactly two drones: the target, and the
  // bystander that keeps the wave from clearing on the kill.
  await startPosed(h);
  await poseBystander(h);
  const targetId = await poseDrone(h, "shard", TARGET_X, TARGET_Y, {
    band: "cyan",
  });
  const target = requireDrone(
    await h.snapshot(),
    targetId,
    "the shot's target",
  );
  await poseShotBelow(h, target.x, target.y, target.effectiveBand, SHOT_BELOW);

  const watch = await watchForEvent(
    h,
    (s) => droneById(s, targetId) === undefined,
    CLIMB_FRAMES,
  );
  // Held on past the reading, so the still shows the burst the kill left rather
  // than the frame the drone vanished on. Nothing after this line can reach an
  // assertion.
  await h.advance(TAIL_FRAMES);
  await captureStill(h, "kill");

  assertEqual(
    watch.hit,
    true,
    `the ${target.effectiveBand} shot placed ${String(SHOT_BELOW)} units below ` +
      `the drone destroyed it inside the ${String(CLIMB_FRAMES)} frames its ` +
      "climb takes (specs/bands.md)",
  );
  assertEqual(
    soundsBeforeEvent(watch),
    0,
    `sounds the build emitted over the ${String(quietFrames(watch))} frames the ` +
      "bullet climbed, on a field where nothing else is happening — a cue is " +
      "played on the frame its event happens (specs/ui.md)",
  );
  assertGreaterThanOrEqual(
    soundsOnEvent(watch),
    1,
    "sounds the build emitted on the frame the matching shot destroyed the " +
      "drone, which is the frame the kill cue is played on (specs/ui.md)",
  );
});
