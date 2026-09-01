// overload/plays-its-cue — an overload sounds a cue of its own.
//
// specs/mode.md closes this mode's reactions with a sound: "Each overload plays the
// `overload` cue in the frame it happens, a distinct short sound beside the nine
// `specs/ui.md` states." specs/ui.md governs all of them with one sentence — "Each
// is played on the frame its event happens and at most once on that frame" — and
// says explicitly that this file is where a mode's own cue is fixed:
// "`specs/mode.md` states whether the mode this build ships plays a cue of its own
// beside these." So the tenth cue is graded here and cannot be graded by the common
// `audio` group, which a base build shares and which has no such cue.
//
// THE MEASUREMENT IS THE ONE EVERY CUE POINT TAKES, and it is deliberately the
// same: `../audio/cues` steps ONE FRAME AT A TIME so a play can be attributed to
// the frame that produced it, and reads what the bus announced on the event's own
// frame against what it announced over the frames before it. A batched drive would
// say only that a sound happened somewhere in the window, which a build that blips
// every frame satisfies. That helper is shared rather than copied so this cue is
// read exactly as the nine are.
//
// THE NAME IS ASSERTED, because under this engine the game defines its cues from
// the instance's `initialize` and plays one BY NAME from the world's audio, and the
// bus announces the play. So `CUES.overload` sounding exactly once on the
// overload's own frame is the whole requirement, and a build that raised some other
// cue there is not credited for it.
//
// THE EVENT IS THE OVERLOAD ITSELF, read as the charge returning to 0, which
// specs/mode.md says an overload does in the frame it happens. A build that charges
// on and never overloads never reaches the event and fails on that, which is the
// honest verdict: there was no overload for a cue to play on.
//
// THE CLIMB IS THE HALF A BUILD CANNOT FAKE. The bullet is placed 200 units under
// the drone and takes better than a quarter of a second to arrive, on a field where
// every faculty of the one drone is off and nothing else is happening — so a
// conforming build plays this cue on none of those frames. A build that blips it
// continuously sounds on the overload's frame too, and fails on the quiet that
// should have come first.
//
// NOTHING IS DESTROYED, so no stage clears; and in any case every assertion below
// names `CUES.overload` alone, which specs/ui.md provides for — "a frame that
// raises more than one of them plays each of those once".

import { afterEach, beforeEach, it } from "vitest";
import {
  CUES,
  OVERLOAD_AT,
  PLAYER_BULLET_HALF,
  PLAYER_BULLET_SPEED,
  SHARD_HALF,
} from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  droneById,
  poseDrone,
  posePlayerBullet,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import {
  cuesBeforeEvent,
  cuesOnEvent,
  gainOnEvent,
  posedDrone,
  quietFrames,
  watchForEvent,
} from "../audio/cues";
import { chargeById, mismatchBand, poseCharge } from "./charge";

/** Where the target Shard stands: mid-field, with room under it for the climb. */
const TARGET_X = LANE_CENTER;
const TARGET_Y = 300;

/**
 * How far below the drone the bullet starts, in logical units.
 *
 * Far enough that the climb is a real window of quiet — at `PLAYER_BULLET_SPEED`
 * (`760`, specs/ship.md) it is better than a quarter of a second — and ten times
 * the contact reach a Shard has against one of the player's bullets
 * (`SHARD_HALF` `14` + `PLAYER_BULLET_HALF` `6`).
 */
const SHOT_BELOW = 10 * (SHARD_HALF + PLAYER_BULLET_HALF);

/**
 * Frames the climb is given to reach the drone.
 *
 * The time to climb the whole `SHOT_BELOW` at `PLAYER_BULLET_SPEED` — geometry,
 * not a tolerance — plus two frames for the frame the bullet is placed on. Contact
 * lands sooner, since the drone's and the bullet's half-extents meet before their
 * centres do.
 */
const CLIMB_FRAMES = ticksFor(SHOT_BELOW / PLAYER_BULLET_SPEED) + 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.overload on the frame a drone overloads, and not over the climb before it", async () => {
  startPosed(h);
  const id = poseDrone(h, "shard", TARGET_X, TARGET_Y, { band: "cyan" });
  poseCharge(h, id, OVERLOAD_AT - 1);
  const target = posedDrone(h, id);
  posePlayerBullet(h, target.x, target.y + SHOT_BELOW, mismatchBand(target));

  const watch = await watchForEvent(
    h,
    (snapshot) => droneById(snapshot, id)?.charge === 0,
    CLIMB_FRAMES,
  );
  captureStill(h, "overload");

  assertEqual(
    watch.hit,
    true,
    `the ${mismatchBand(target)} shot placed ${String(SHOT_BELOW)} units below ` +
      `a drone at charge ${String(OVERLOAD_AT - 1)} overloaded it inside the ` +
      `${String(CLIMB_FRAMES)} frames its climb takes (specs/mode.md)`,
  );
  assertEqual(
    chargeById(watch.snapshot, id, "the drone that has just overloaded"),
    0,
    "the charge that says the frame this check read really was the overload's " +
      "(specs/mode.md)",
  );
  assertEqual(
    cuesBeforeEvent(watch, CUES.overload),
    0,
    `times CUES.overload played over the ${String(quietFrames(watch))} frames ` +
      "the bullet climbed, on a field where nothing else is happening — a cue is " +
      "played on the frame its event happens (specs/ui.md)",
  );
  assertEqual(
    cuesOnEvent(watch, CUES.overload),
    1,
    "times CUES.overload played on the frame the drone overloaded, which is its " +
      "own frame and at most once on it (specs/mode.md, specs/ui.md)",
  );
  assertGreaterThan(
    gainOnEvent(watch, CUES.overload),
    0,
    "the gain the bus announced the overload cue at, nothing here having muted " +
      "it — it is a distinct short sound a player hears (specs/mode.md)",
  );
});
